import os
import keras

model_path = os.path.join('notebooks', 'protein_ss_model.h5')

try:
    # Try loading with keras directly
    model = keras.models.load_model(model_path)
    print("Model loaded successfully with Keras.")
    model.summary()
    print(f"Input shape: {model.input_shape}")
    print(f"Output shape: {model.output_shape}")
except Exception as e:
    print(f"Error loading model: {e}")
