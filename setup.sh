#!/bin/bash

# Finance Seer Setup Script

echo "🚀 Finance Seer - Setup & Initialization"
echo "==========================================="
echo ""

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v)
echo "✓ Node.js $NODE_VERSION"

# Check npm
echo "Checking npm..."
NPM_VERSION=$(npm -v)
echo "✓ npm $NPM_VERSION"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check installation
if [ $? -eq 0 ]; then
  echo "✓ Dependencies installed successfully"
else
  echo "✗ Error installing dependencies"
  exit 1
fi

# Create data directory
echo ""
echo "📁 Creating data directory..."
mkdir -p data
echo "✓ Data directory created"

# Build the project
echo ""
echo "🔨 Building project..."
npm run build

if [ $? -eq 0 ]; then
  echo "✓ Build successful"
else
  echo "✗ Build failed"
  exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the development server, run:"
echo "  npm run dev"
echo ""
echo "Then open http://localhost:3000 in your browser"
echo ""
echo "📝 Demo Account:"
echo "   Email: demo@finance-seer.com"
echo "   Password: demo123"
echo ""
