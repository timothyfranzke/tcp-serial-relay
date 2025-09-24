#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Make sure we have the necessary packages
log_info "Installing required packages for protobuf and cmake..."
apt-get update
apt-get install -y build-essential cmake pkg-config libboost-all-dev libssl-dev zlib1g-dev wget autoconf automake libtool curl make g++ unzip

# Remove any existing protobuf installations that might be causing conflicts
log_info "Removing any existing protobuf installations..."
apt-get remove -y libprotobuf-dev protobuf-compiler
apt-get autoremove -y

# Install protobuf from source with proper configuration
log_info "Installing protobuf from source..."

# Create build directory
TEMP_PROTOBUF_DIR="/tmp/protobuf-build"
rm -rf "$TEMP_PROTOBUF_DIR"
mkdir -p "$TEMP_PROTOBUF_DIR"
cd "$TEMP_PROTOBUF_DIR"

# Download protobuf source
wget https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protobuf-cpp-3.21.12.tar.gz
tar -xzf protobuf-cpp-3.21.12.tar.gz
cd protobuf-3.21.12

# Configure and build with explicit paths
log_info "Configuring protobuf..."

# Check if configure exists
if [ ! -f "./configure" ]; then
    log_error "configure script not found, downloading full source instead..."
    cd ..
    rm -rf protobuf-3.21.12
    
    # Clone the git repo instead which has the autogen.sh script
    git clone https://github.com/protocolbuffers/protobuf.git
    cd protobuf
    git checkout v3.21.12
    
    # Run autogen to generate configure
    log_info "Running autogen.sh..."
    ./autogen.sh
fi

# Now run configure
./configure --prefix=/usr
if [ $? -ne 0 ]; then
    log_error "Failed to configure protobuf"
    exit 1
fi

log_info "Building protobuf (this may take a few minutes)..."
make -j$(nproc 2>/dev/null || echo 2)
if [ $? -ne 0 ]; then
    log_error "Failed to build protobuf"
    exit 1
fi

log_info "Installing protobuf..."
make install
if [ $? -ne 0 ]; then
    log_error "Failed to install protobuf"
    exit 1
fi

ldconfig

# Create symbolic links if needed
if [ ! -f "/usr/bin/protoc" ] && [ -f "/usr/local/bin/protoc" ]; then
    log_info "Creating symbolic link for protoc..."
    ln -sf /usr/local/bin/protoc /usr/bin/protoc
fi

# Set environment variables
export PKG_CONFIG_PATH="/usr/lib/pkgconfig:/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH"
export LD_LIBRARY_PATH="/usr/lib:/usr/local/lib:$LD_LIBRARY_PATH"
export LIBRARY_PATH="/usr/lib:/usr/local/lib:$LIBRARY_PATH"
export CPLUS_INCLUDE_PATH="/usr/include:/usr/local/include:$CPLUS_INCLUDE_PATH"
export C_INCLUDE_PATH="/usr/include:/usr/local/include:$C_INCLUDE_PATH"

# Create pkg-config file if it doesn't exist
if [ ! -f "/usr/lib/pkgconfig/protobuf.pc" ]; then
    log_info "Creating pkg-config file for protobuf..."
    cat > /usr/lib/pkgconfig/protobuf.pc << EOF
prefix=/usr
exec_prefix=\${prefix}
libdir=\${prefix}/lib
includedir=\${prefix}/include

Name: Protocol Buffers
Description: Google's Data Interchange Format
Version: 3.21.12
Libs: -L\${libdir} -lprotobuf
Cflags: -I\${includedir}
EOF
fi

# Add these environment variables to .bashrc for persistence
cat >> ~/.bashrc << EOF
export PKG_CONFIG_PATH="/usr/lib/pkgconfig:/usr/local/lib/pkgconfig:\$PKG_CONFIG_PATH"
export LD_LIBRARY_PATH="/usr/lib:/usr/local/lib:\$LD_LIBRARY_PATH"
export LIBRARY_PATH="/usr/lib:/usr/local/lib:\$LIBRARY_PATH"
export CPLUS_INCLUDE_PATH="/usr/include:/usr/local/include:\$CPLUS_INCLUDE_PATH"
export C_INCLUDE_PATH="/usr/include:/usr/local/include:\$C_INCLUDE_PATH"
EOF

# Clean up
cd /
rm -rf "$TEMP_PROTOBUF_DIR"

# Verify installation
log_info "Verifying protobuf installation..."

# Check multiple possible locations
PROTOC_PATH=""
for path in "/usr/bin/protoc" "/usr/local/bin/protoc" "/bin/protoc"; do
    if [ -f "$path" ]; then
        PROTOC_PATH="$path"
        log_info "Found protoc at $PROTOC_PATH"
        break
    fi
done

if [ -z "$PROTOC_PATH" ]; then
    # Try to find it using find command
    log_info "Searching for protoc binary..."
    PROTOC_PATH=$(find /usr -name protoc -type f 2>/dev/null | head -1)
    
    if [ -z "$PROTOC_PATH" ]; then
        log_error "protoc binary not found anywhere in the system"
        exit 1
    else
        log_info "Found protoc at $PROTOC_PATH"
    fi
fi

# Make sure it's executable
chmod +x "$PROTOC_PATH"

# Add to PATH if needed
PROTOC_DIR=$(dirname "$PROTOC_PATH")
if [[ ":$PATH:" != *":$PROTOC_DIR:"* ]]; then
    log_info "Adding $PROTOC_DIR to PATH"
    export PATH="$PROTOC_DIR:$PATH"
    echo "export PATH=\"$PROTOC_DIR:\$PATH\"" >> ~/.bashrc
fi

# Verify protoc is now in PATH
which protoc
if [ $? -ne 0 ]; then
    log_error "protoc binary still not found in PATH"
    exit 1
fi

PROTOC_VERSION=$(protoc --version 2>/dev/null)
if [ $? -eq 0 ]; then
    log_success "Protobuf installed successfully: $PROTOC_VERSION"
else
    log_error "Protobuf installation verification failed"
    
    # Check if the binary exists but isn't executable
    if [ -f /usr/bin/protoc ]; then
        log_info "Found protoc binary, fixing permissions..."
        chmod +x /usr/bin/protoc
        PROTOC_VERSION=$(protoc --version 2>/dev/null)
        if [ $? -eq 0 ]; then
            log_success "Fixed protoc permissions. Protobuf installed successfully: $PROTOC_VERSION"
        else
            log_error "Still unable to execute protoc"
            exit 1
        fi
    else
        log_error "protoc binary not found at /usr/bin/protoc"
        exit 1
    fi
fi

# Check for library files
if [ ! -f /usr/lib/libprotobuf.so ]; then
    log_error "libprotobuf.so not found"
    exit 1
fi

log_success "Protobuf libraries verified"

log_info "You may need to run 'source ~/.bashrc' or start a new shell for environment variables to take effect"
log_success "Protobuf installation for CMake completed"
