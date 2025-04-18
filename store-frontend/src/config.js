const config = {
  API_URL: process.env.REACT_APP_API_URL || 'http://localhost:5000',
  SOCKET_URL: process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000',
  DEFAULT_ERROR_MESSAGE: 'An error occurred. Please try again.',
  QR_SCANNER_CONFIG: {
    fps: 10,
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1.0,
    formatsToSupport: [0], // Only support QR code format (0) for faster initialization
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: true
  }
};

export default config;
