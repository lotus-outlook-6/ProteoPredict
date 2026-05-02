import os
import math
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle

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
