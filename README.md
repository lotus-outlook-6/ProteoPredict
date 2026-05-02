# ProteoPredict
Premium Protein Secondary Structure Prediction Web App

This application showcases a trained 1D CNN + BiLSTM model for predicting protein secondary structure (Helix, Sheet, Coil) from amino acid sequences.

## 🚀 Features
- **Modern UI**: Dark mode with glassmorphism and indigo/purple glows.
- **Dynamic Visualization**: Interactive block visualization of predicted structures.
- **Staggered Animations**: Micro-animations for a premium feel.
- **Fast Performance**: Optimized backend with FastAPI and TensorFlow-CPU.

## 🛠️ Setup & Usage

### 1. Requirements
Ensure you have Python 3.12+ installed. The following packages have been pre-installed for you:
- `tensorflow-cpu`
- `fastapi`
- `uvicorn`
- `keras`

### 2. Start the Backend
Navigate to the root directory and run:
`python backend/app.py`
The backend will start at `http://localhost:8000`.

### 3. Start the Frontend
Open `frontend/index.html` in any modern web browser.
Alternatively, if you have Node.js:
`cd frontend && npm run dev`

## 📊 Model Details
- **Architecture**: 1D CNN + Bidirectional LSTM
- **Max Sequence Length**: 1200 residues
- **Dataset**: CullPDB (6133 sequences)
- **Classes**: 
  - **H**: Alpha Helix (Orange)
  - **E**: Beta Sheet (Blue)
  - **C**: Random Coil (Slate)
