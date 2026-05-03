import os
import math
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import google.generativeai as genai
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

# Setup Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if GEMINI_API_KEY and GEMINI_API_KEY != "YOUR_NEW_API_KEY_HERE":
    genai.configure(api_key=GEMINI_API_KEY)

def search_rcsb_pdb(sequence: str) -> str:
    """Searches the RCSB PDB database for a given protein sequence. Returns a clickable HTML link to the 3D viewer if found, or an error message. Only use this if the user asks to search for the structure or PDB."""
    if len(sequence) < 20:
        return "This sequence is too short to reliably search the PDB database."
    import urllib.request
    import json
    rcsb_url = "https://search.rcsb.org/rcsbsearch/v2/query"
    query_data = {
        "query": {
            "type": "terminal",
            "service": "sequence",
            "parameters": {
                "evalue_cutoff": 0.1,
                "identity_cutoff": 0.9,
                "sequence_type": "protein",
                "value": sequence
            }
        },
        "return_type": "entry"
    }
    try:
        req = urllib.request.Request(rcsb_url, data=json.dumps(query_data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as res:
            rcsb_res = json.loads(res.read().decode('utf-8'))
            if 'result_set' in rcsb_res and len(rcsb_res['result_set']) > 0:
                pdb_id = rcsb_res['result_set'][0]['identifier']
                return f"PDB Match Found: {pdb_id}. To display it, return this exact HTML to the user: <br><br><a href='#' class='load-pdb-link' data-pdb='{pdb_id}' style='color: #578dd9; font-weight: 600; text-decoration: underline;'><i class='fas fa-cube'></i> Click here to load {pdb_id} in the 3D Viewer</a>"
            else:
                return "No close structural match found in the RCSB PDB database for this sequence."
    except Exception as e:
        return f"Failed to search PDB: {str(e)}"

# ============================================
# Configuration
# ============================================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(BASE_DIR, 'models')
MODEL_PATH = os.path.join(MODEL_DIR, 'proteopredict_pro_model.h5')
ENCODING_PATH = os.path.join(MODEL_DIR, 'encoding_info.pkl')

# Load encoding info
with open(ENCODING_PATH, 'rb') as f:
    encoding_info = pickle.load(f)

AMINO_ACIDS = encoding_info['amino_acids']  # 'ACDEFGHIKLMNPQRSTVWY'
MAX_LEN = encoding_info['max_len']          # 1200
SS_LABELS = encoding_info['ss_labels']      # ['H', 'E', 'C']
AA_TO_IDX = {aa: i for i, aa in enumerate(AMINO_ACIDS)}

# ============================================
# Molecular weight table (Daltons) for each amino acid
# ============================================
MW_TABLE = {
    'A': 89.09, 'R': 174.20, 'N': 132.12, 'D': 133.10, 'C': 121.16,
    'Q': 146.15, 'E': 147.13, 'G': 75.03, 'H': 155.16, 'I': 131.17,
    'L': 131.17, 'K': 146.19, 'M': 149.21, 'F': 165.19, 'P': 115.13,
    'S': 105.09, 'T': 119.12, 'W': 204.23, 'Y': 181.19, 'V': 117.15
}

# ============================================
# Flask App
# ============================================
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# ============================================
# Model Loading (Eager)
# ============================================
model = None

def load_model_safe():
    """Load the multi-task Keras model."""
    global model
    try:
        os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
        import tensorflow as tf
        model = tf.keras.models.load_model(MODEL_PATH)
        print(f"[OK] Model loaded successfully from {MODEL_PATH}")
    except Exception as e:
        print(f"[ERROR] Error loading model: {e}")

# Load model immediately at startup so it's ready for the first request
load_model_safe()


def encode_sequence(seq):
    """One-hot encode an amino acid sequence."""
    encoded = np.zeros((MAX_LEN, 20), dtype=np.float32)
    for i, aa in enumerate(seq[:MAX_LEN]):
        if aa in AA_TO_IDX:
            encoded[i][AA_TO_IDX[aa]] = 1.0
    return encoded


def compute_sequence_stats(seq, structure_str, solubility_list, disorder_list):
    """Compute comprehensive sequence statistics."""
    length = len(seq)
    aa_counts = {aa: seq.count(aa) for aa in AMINO_ACIDS}

    # Molecular weight (subtract water for peptide bonds)
    mw = sum(MW_TABLE.get(aa, 0) for aa in seq) - (length - 1) * 18.015

    # Aromaticity: fraction of F, W, Y
    aromatic_count = sum(seq.count(aa) for aa in 'FWY')
    aromaticity = round(aromatic_count / length, 4) if length else 0

    # Hydrophobicity: fraction of hydrophobic residues
    hydrophobic_count = sum(seq.count(aa) for aa in 'AVILMFYW')
    hydrophobicity = round(hydrophobic_count / length, 4) if length else 0

    # Structure percentages
    h_count = structure_str.count('H')
    e_count = structure_str.count('E')
    c_count = structure_str.count('C')

    helix_pct = round(h_count / length * 100, 1) if length else 0
    sheet_pct = round(e_count / length * 100, 1) if length else 0
    coil_pct = round(c_count / length * 100, 1) if length else 0

    # Averages for solubility and disorder
    avg_solubility = round(sum(solubility_list) / length, 4) if length else 0
    avg_disorder = round(sum(disorder_list) / length, 4) if length else 0

    return {
        'length': length,
        'mw': round(mw, 1),
        'aromaticity': aromaticity,
        'hydrophobicity': hydrophobicity,
        'helix_percent': helix_pct,
        'sheet_percent': sheet_pct,
        'coil_percent': coil_pct,
        'avg_solubility': avg_solubility,
        'avg_disorder': avg_disorder,
        'aa_counts': aa_counts
    }


# ============================================
# API Routes
# ============================================

@app.route('/')
def root():
    return jsonify({
        'status': 'online',
        'app': 'ProteoPredict Pro',
        'model_loaded': model is not None,
        'version': '2.0'
    })


@app.route('/predict', methods=['POST'])
def predict():
    global model

    # Model is now loaded at startup
    if model is None:
        return jsonify({'error': 'Model failed to load at startup. Check server logs.'}), 500

    data = request.json
    if not data or 'sequence' not in data:
        return jsonify({'error': 'No sequence provided'}), 400

    seq = data['sequence'].upper().strip()

    # Validate
    if len(seq) < 5:
        return jsonify({'error': 'Sequence too short (minimum 5 amino acids)'}), 400
    if len(seq) > MAX_LEN:
        return jsonify({'error': f'Sequence too long (maximum {MAX_LEN} amino acids)'}), 400

    invalid_chars = [c for c in seq if c not in AMINO_ACIDS]
    if invalid_chars:
        return jsonify({'error': f'Invalid amino acids: {", ".join(set(invalid_chars))}'}), 400

    # Encode & predict
    encoded = encode_sequence(seq)
    input_data = np.expand_dims(encoded, axis=0)  # (1, 1200, 20)

    try:
        predictions = model.predict(input_data, verbose=0)

        # Model outputs: [structure(1,1200,3), solubility(1,1200,1), disorder(1,1200,1)]
        structure_pred = predictions[0][0]   # (1200, 3)
        solubility_pred = predictions[1][0]  # (1200, 1)
        disorder_pred = predictions[2][0]    # (1200, 1)

        # Trim to actual sequence length
        seq_len = len(seq)

        # Structure: argmax → H/E/C labels
        structure_indices = np.argmax(structure_pred[:seq_len], axis=-1)
        structure_str = ''.join([SS_LABELS[idx] for idx in structure_indices])

        # Solubility: sigmoid output → clip to [0, 1]
        solubility_vals = np.clip(solubility_pred[:seq_len, 0], 0, 1).tolist()
        solubility_vals = [round(v, 4) for v in solubility_vals]

        # Disorder: sigmoid output → clip to [0, 1]
        disorder_vals = np.clip(disorder_pred[:seq_len, 0], 0, 1).tolist()
        disorder_vals = [round(v, 4) for v in disorder_vals]

        # Stats
        stats = compute_sequence_stats(seq, structure_str, solubility_vals, disorder_vals)

        return jsonify({
            'sequence': seq,
            'length': seq_len,
            'structure': structure_str,
            'solubility': solubility_vals,
            'disorder': disorder_vals,
            'stats': stats
        })

    except Exception as e:
        return jsonify({'error': f'Prediction error: {str(e)}'}), 500


@app.route('/chat', methods=['POST'])
def chat():
    """Interactive chat assistant for protein analysis."""
    data = request.json
    if not data or 'message' not in data:
        return jsonify({'error': 'No message provided'}), 400

    msg = data.get('message', '')
    msg_lower = msg.lower()
    sequence = data.get('sequence', 'Unknown')
    stats = data.get('stats', {})
    use_gemini = data.get('use_gemini', True)

    if not use_gemini:
        # Local "Mock" AI Logic
        response = ""
        import re
        if "solubility" in msg_lower:
            val = stats.get('avg_solubility', 0)
            if val > 0.6:
                response = f"<strong>(Local Mode)</strong> This protein is highly soluble ({val:.2f}). This usually indicates it exists in the cytoplasm."
            else:
                response = f"<strong>(Local Mode)</strong> Solubility is quite low ({val:.2f}), suggesting a membrane-bound or hydrophobic protein."
        elif "helix" in msg_lower or "structure" in msg_lower:
            h = stats.get('helix_percent', 0)
            s = stats.get('sheet_percent', 0)
            response = f"<strong>(Local Mode)</strong> Structural profile: {h}% Helix, {s}% Sheet."
        elif "pdb" in msg_lower or "search" in msg_lower:
            response = search_rcsb_pdb(sequence)
        else:
            response = f"<strong>(Local Mode)</strong> I am running in offline mode. I can see this is a {stats.get('length')}aa sequence. Switch to 'Gemini' mode for deeper biochemical insights!"
        return jsonify({'response': response})

    if not GEMINI_API_KEY or GEMINI_API_KEY == "YOUR_NEW_API_KEY_HERE":
        return jsonify({'response': "<strong>Gemini API key not configured!</strong> Add your key to the <code>.env</code> file in the project root. Get one at <a href='https://aistudio.google.com/apikey' target='_blank'>aistudio.google.com/apikey</a>."})

    try:
        system_instruction = f"You are ProteoPredict AI, an expert structural biology and bioinformatics assistant. Your ONLY purpose is to answer questions related to protein structures, amino acid sequences, solubility, disorder, mutations, and biochemistry. If the user asks about anything else, politely refuse. Be concise, professional, and use markdown formatting (like bolding) to make answers readable. Avoid lengthy paragraphs.\n\nContext for current protein:\nSequence: {sequence}\nLength: {stats.get('length')} aa\nMol Weight: {stats.get('mw')} Da\nHelix: {stats.get('helix_percent')}%\nSheet: {stats.get('sheet_percent')}%\nCoil: {stats.get('coil_percent')}%\nSolubility: {stats.get('avg_solubility')}\nDisorder: {stats.get('avg_disorder')}"
        
        model = genai.GenerativeModel(
            model_name='gemini-2.5-flash',
            tools=[search_rcsb_pdb],
            system_instruction=system_instruction
        )
        
        chat = model.start_chat(enable_automatic_function_calling=True)
        response = chat.send_message(msg)
        
        # Replace markdown bolding with strong tags for the frontend if needed, though the frontend supports basic HTML.
        # Actually we can just convert markdown to HTML simply or return markdown. The frontend displays HTML directly.
        try:
            res_text = response.text
        except:
            res_text = "I've processed your request. You can see the updated data in the analysis results above."

        html_response = res_text.replace('\n', '<br>')
        
        # Simple markdown bold to HTML strong
        import re
        html_response = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', html_response)
        
        return jsonify({'response': html_response})

    except Exception as e:
        return jsonify({'error': f"Gemini API Error: {str(e)}"}), 500


# ============================================
# Run Server
# ============================================
if __name__ == '__main__':
    print("=" * 50)
    print("  ProteoPredict Pro — Backend Server")
    print("=" * 50)
    print(f"  Status: {'READY' if model else 'FAILED TO LOAD'}")
    print("=" * 50)
    # Enable threaded mode to prevent blocking the UI during long inference
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
