"""Pytest configuration for backend tests."""
import sys
import os
from pathlib import Path

# Get the backend directory
backend_dir = Path(__file__).parent.parent

# Add src directory to path for tests
sys.path.insert(0, str(backend_dir / "src"))

# Add each Lambda function directory to path so they can find their local utils/models
lambda_dirs = [
    backend_dir / "src" / "lambdas" / "auth",
    backend_dir / "src" / "lambdas" / "accounts",
    backend_dir / "src" / "lambdas" / "expenses",
    backend_dir / "src" / "lambdas" / "analytics",
    backend_dir / "src" / "lambdas" / "email",
]

for lambda_dir in lambda_dirs:
    if lambda_dir.exists():
        sys.path.insert(0, str(lambda_dir))

