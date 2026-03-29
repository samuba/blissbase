#!/bin/bash

# Deploy script for whatsapp2sqlite from blissbase repo
# This script clones the repo, extracts the whatsapp2sqlite project, builds it,
# and sets up a systemd user service to run it as a daemon.

set -e  # Exit on any error

# Always run from the parent of the script's directory so relative paths work
# regardless of where the script is invoked from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Configuration
REPO_NAME="blissbase"
REPO_URL="blissbase"  # Uses gh CLI default (github.com)
SOURCE_DIR="${REPO_NAME}/whatsapp2sqlite"
TARGET_DIR="./whatsapp2sqlite"
SERVICE_NAME="whatsapp2sqlite"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if gh CLI is installed and authenticated
check_gh_cli() {
    log_info "Checking GitHub CLI..."
    if ! command -v gh &> /dev/null; then
        log_error "GitHub CLI (gh) is not installed. Please install it first."
        exit 1
    fi
    
    if ! gh auth status &> /dev/null; then
        log_error "GitHub CLI is not authenticated. Please run 'gh auth login' first."
        exit 1
    fi
    log_info "GitHub CLI is ready"
}

# Check if Go is installed
check_go() {
    log_info "Checking Go installation..."
    if ! command -v go &> /dev/null; then
        log_error "Go is not installed. Please install Go first."
        exit 1
    fi
    log_info "Go version: $(go version)"
}

# Clone the repository
clone_repo() {
    log_info "Cloning blissbase repository..."
    
    # Remove existing repo directory if it exists
    if [ -d "$REPO_NAME" ]; then
        log_warn "Removing existing $REPO_NAME directory..."
        rm -rf "$REPO_NAME"
    fi
    
    # Clone using gh CLI
    gh repo clone "$REPO_URL" "$REPO_NAME"
    log_info "Repository cloned successfully"
}

# Copy whatsapp2sqlite to target directory
extract_project() {
    log_info "Extracting whatsapp2sqlite project..."
    
    if [ ! -d "$SOURCE_DIR" ]; then
        log_error "Source directory $SOURCE_DIR not found in the repository"
        exit 1
    fi
    
    # Create target directory if it doesn't exist
    mkdir -p "$TARGET_DIR"
    
    # Copy the project files without deleting existing files/directories
    cp -r "$SOURCE_DIR/." "$TARGET_DIR/"
    log_info "Project copied to $TARGET_DIR"
}

# Clean up repository
cleanup_repo() {
    log_info "Cleaning up repository..."
    rm -rf "$REPO_NAME"
    log_info "Repository cleaned up"
}

# Build the Go project
build_project() {
    log_info "Building Go project..."
    
    cd "$TARGET_DIR"
    
    # Initialize go modules if go.mod doesn't exist
    if [ ! -f "go.mod" ]; then
        log_info "Initializing Go module..."
        go mod init whatsapp2sqlite 2>/dev/null || true
    fi
    
    # Tidy and download dependencies
    go mod tidy 2>/dev/null || true
    
    # Build the project
    go build -o whatsapp2sqlite .
    
    if [ ! -f "whatsapp2sqlite" ]; then
        log_error "Build failed - binary not found"
        exit 1
    fi
    
    log_info "Build successful: $(pwd)/whatsapp2sqlite"
    cd - > /dev/null
}

# Get absolute path for the binary
get_binary_path() {
    cd "$TARGET_DIR"
    pwd
    cd - > /dev/null
}

# Create or update systemd user service
setup_service() {
    log_info "Setting up systemd user service..."
    
    BINARY_PATH=$(get_binary_path)
    SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
    SERVICE_FILE="$SYSTEMD_USER_DIR/${SERVICE_NAME}.service"
    
    # Create systemd user directory if it doesn't exist
    mkdir -p "$SYSTEMD_USER_DIR"
    
    # Create the service file
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=WhatsApp to SQLite Service
After=network.target

[Service]
Type=simple
WorkingDirectory=${BINARY_PATH}
ExecStart=${BINARY_PATH}/whatsapp2sqlite
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
    
    log_info "Service file created: $SERVICE_FILE"
    
    # Reload systemd user daemon
    systemctl --user daemon-reload
    
    # Enable the service to start on boot
    systemctl --user enable "$SERVICE_NAME"
    
    # Stop the service if it's already running
    if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Stopping existing service..."
        systemctl --user stop "$SERVICE_NAME"
    fi
    
    # Start the service
    log_info "Starting $SERVICE_NAME service..."
    systemctl --user start "$SERVICE_NAME"
    
    # Check service status
    sleep 2
    if systemctl --user is-active --quiet "$SERVICE_NAME"; then
        log_info "Service is running successfully!"
        systemctl --user status "$SERVICE_NAME" --no-pager
    else
        log_error "Service failed to start. Check logs with: journalctl --user -u $SERVICE_NAME"
        systemctl --user status "$SERVICE_NAME" --no-pager || true
        exit 1
    fi
}

# Main execution
main() {
    log_info "Starting deployment of whatsapp2sqlite..."
    
    # Check prerequisites
    check_gh_cli
    check_go
    
    # Clone and extract
    clone_repo
    extract_project
    cleanup_repo
    
    # Build
    build_project
    
    # Setup service
    setup_service
    
    log_info "Deployment completed successfully!"
    log_info ""
    log_info "Useful commands:"
    log_info "  - Check status: systemctl --user status $SERVICE_NAME"
    log_info "  - View logs: journalctl --user -u $SERVICE_NAME -f"
    log_info "  - Restart: systemctl --user restart $SERVICE_NAME"
    log_info "  - Stop: systemctl --user stop $SERVICE_NAME"
    log_info ""
    log_info "The service is enabled to start automatically on server reboot."
}

# Run main function
main "$@"