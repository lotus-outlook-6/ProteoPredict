try:
    import tensorflow as tf
    print(f"TensorFlow version: {tf.__version__}")
except ImportError as e:
    print(f"ImportError: {e}")
except Exception as e:
    import traceback
    traceback.print_exc()
