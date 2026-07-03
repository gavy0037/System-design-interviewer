import sys
import os

# Add the project root to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from backend.main import app
