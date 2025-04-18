import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  InputAdornment
} from '@mui/material';
import { LoadingButton } from '@mui/lab';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import StopIcon from '@mui/icons-material/Stop';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import io from 'socket.io-client';
import config from '../config';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
const [stopDisabled, setStopDisabled] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [studentData, setStudentData] = useState(null);
  const [amount, setAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [dailyStats, setDailyStats] = useState({
    totalSales: 0,
    totalTransactions: 0,
    pendingSettlement: 0
  });

  // Fetch daily stats
  const updateDailyStats = useCallback(async () => {
    try {
      const storeId = parseInt(user.storeId, 10);
      console.log('Fetching stats for store:', storeId);
      
      const response = await axios.get(`${config.API_URL}/api/stores/${storeId}/daily-stats`);
      setDailyStats(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching daily stats:', error);
      if (error.response?.status === 401 || error.response?.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        delete axios.defaults.headers.common['Authorization'];
        navigate('/login');
      }
    }
  }, [user.storeId, navigate]);

  // Initial data fetch
  useEffect(() => {
    updateDailyStats();
  }, [updateDailyStats]);

  const handleTransaction = async () => {
    try {
      setProcessing(true);
      setError('');
      
      if (!studentData || !amount || parseFloat(amount) <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const response = await axios.post(`${config.API_URL}/api/transaction`, {
        studentId: studentData.student_id,
        amount: parseFloat(amount),
        storeId: parseInt(user.storeId, 10)
      });

      console.log('Transaction successful:', response.data);
      setSuccess('Transaction completed successfully');
      setAmount('');
      setDialogOpen(false);
      updateDailyStats();

    } catch (error) {
      console.error('Transaction error:', error);
      setError(error.response?.data?.error || config.DEFAULT_ERROR_MESSAGE);
    } finally {
      setProcessing(false);
    }
  };

  // Socket.io connection effect
  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      navigate('/login');
      return;
    }

    const socket = io(config.SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('Connected to WebSocket server');
      setError('');
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      if (error.message.includes('Authentication error')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from WebSocket:', reason);
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('transactionUpdate', (data) => {
      console.log('Received transaction update:', data);
      updateDailyStats();
    });

    socket.on('settlementUpdate', (data) => {
      console.log('Received settlement update:', data);
      updateDailyStats();
    });

    return () => {
      socket.disconnect();
    };
  }, [navigate, updateDailyStats]);

  // References to hold the scanner instance and component state
  const scannerRef = React.useRef(null);
  const isMounted = React.useRef(true);
  
  // Track component mount status to prevent state updates after unmount
  useEffect(() => {
    isMounted.current = true;
    
    // Just check for camera permissions, don't create scanner yet
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
          // We got permission, now close the stream
          stream.getTracks().forEach(track => track.stop());
          console.log('Camera permissions granted');
        })
        .catch(err => {
          console.error('Error getting camera permissions:', err);
        });
    }
    
    // Clean up function
    return () => {
      // Mark component as unmounted to prevent state updates
      isMounted.current = false;
      
      // Clean up scanner if it exists
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().catch(() => {});
          }
        } catch (err) {
          console.error('Error cleaning up scanner:', err);
        }
        scannerRef.current = null;
      }
    };
  }, []);

  // Safe state update function that checks if component is still mounted
  const safeSetState = (stateSetter, value) => {
    if (isMounted.current) {
      stateSetter(value);
    }
  };
  
  // Function to ensure camera is fully released
  const releaseCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current = null;
        
        // Force release all camera streams
        document.querySelectorAll('video').forEach(video => {
          if (video.srcObject) {
            const tracks = video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            video.srcObject = null;
          }
        });
      } catch (err) {
        console.error('Error releasing camera:', err);
      }
    }
  };

  // QR Scanner management effect
  useEffect(() => {
    // Don't do anything if not scanning
    if (!scanning) {
      // If we're not scanning, make sure camera is released
      releaseCamera();
      return;
    }
    
    // Prevent multiple initializations
    if (scannerRef.current && scannerRef.current.isScanning) {
      return;
    }
    
    // Set starting camera state to true
    safeSetState(setIsStartingCamera, true);
    safeSetState(setError, '');
    // Make sure status message is visible
    safeSetState(setStatusMessage, 'Camera is starting, please wait...');
    safeSetState(setSuccess, '');
    
    let html5QrCode;
    
    // Use setTimeout to ensure state updates are processed before heavy operations
    const initializeScanner = setTimeout(() => {
      try {
        // Create a new Html5Qrcode instance directly (not the scanner UI)
        html5QrCode = new Html5Qrcode('reader');
        scannerRef.current = html5QrCode;
        
        const qrConfig = {
          fps: 10,
          qrbox: 250,
          aspectRatio: 1.0,
          formatsToSupport: [0], // Only QR code format
          disableFlip: true,
          showTorchButtonIfSupported: true
        };
        
        const qrCodeSuccessCallback = async (decodedText) => {
          try {
            // Check if component is still mounted
            if (!isMounted.current) return;
            
            // Set stopping state to prevent further scans
            safeSetState(setIsStopping, true);
            safeSetState(setStatusMessage, 'QR code detected! Processing...');
            
            // Stop scanning first to prevent any issues
            await html5QrCode.stop();
            
            console.log('QR Code detected:', decodedText);
            
            // Parse the JSON data
            const qrData = JSON.parse(decodedText);
            console.log('Parsed QR data:', qrData);
            
            // Get student ID (handle both id and student_id formats)
            const studentId = qrData.student_id || qrData.id;
            
            if (!studentId) {
              console.error('No student ID found in QR data:', qrData);
              throw new Error('Invalid QR code format');
            }
            
            // Fetch student details
            const response = await axios.get(`${config.API_URL}/api/students/${studentId}`);
            
            // Update state safely
            if (isMounted.current) {
              safeSetState(setScanning, false);
              safeSetState(setIsStartingCamera, false);
              safeSetState(setIsStopping, false);
              safeSetState(setStudentData, response.data);
              safeSetState(setDialogOpen, true);
              safeSetState(setStatusMessage, '');
              safeSetState(setSuccess, 'Student found!');
            }
            
          } catch (error) {
            console.error('Error processing QR code:', error);
            if (isMounted.current) {
              safeSetState(setError, 'Invalid QR code format. Please try again.');
              safeSetState(setScanning, false);
              safeSetState(setIsStartingCamera, false);
              safeSetState(setIsStopping, false);
              safeSetState(setStatusMessage, '');
            }
          }
        };
        
        // Start scanning
        html5QrCode.start(
          { facingMode: 'environment' }, // Use back camera
          qrConfig,
          qrCodeSuccessCallback,
          (errorMessage) => {
            // Ignore common scan errors
            if (errorMessage.includes('NotFoundException')) return;
            console.warn('QR Scan error:', errorMessage);
          }
        ).then(() => {
          // Camera started successfully
          if (isMounted.current) {
            safeSetState(setIsStartingCamera, false);
            safeSetState(setStatusMessage, '');
            safeSetState(setSuccess, 'Camera ready. Please scan a QR code.');
          }
        }).catch(err => {
          console.error('Error starting camera:', err);
          if (isMounted.current) {
            safeSetState(setError, 'Failed to start camera. Please check permissions and try again.');
            safeSetState(setScanning, false);
            safeSetState(setIsStartingCamera, false);
            safeSetState(setStatusMessage, '');
            scannerRef.current = null;
          }
        });
      } catch (err) {
        console.error('Error initializing scanner:', err);
        if (isMounted.current) {
          safeSetState(setError, 'Failed to initialize camera. Please try again.');
          safeSetState(setScanning, false);
          safeSetState(setIsStartingCamera, false);
          safeSetState(setStatusMessage, '');
        }
      }
    }, 100);
    
    // Clean up function
    return () => {
      // Clear the initialization timeout if component unmounts quickly
      clearTimeout(initializeScanner);
      
      // Fully release camera resources
      releaseCamera();
    };
  }, [scanning]);

  const startScanning = () => {
    // If camera is already starting or stopping, prevent multiple clicks
    if (isStartingCamera) {
      setStatusMessage('Camera is starting, please wait...');
      return;
    }
    
    if (isStopping) {
      setStatusMessage('Camera is stopping, please wait...');
      return;
    }
    
    // Clear previous scanner if exists
    if (scannerRef.current && scannerRef.current.isScanning) {
      setSuccess('Camera is already running');
      return;
    }
    
    // Clear previous messages
    setError('');
    setSuccess('');
    
    // Start scanner
    setScanning(true);
    setStatusMessage('Camera is starting, please wait...');
    setStopDisabled(true);
    setTimeout(() => setStopDisabled(false), 4000);
  };

  const stopScanning = () => {
    // Always allow stopping, even if camera is starting
    // This fixes the issue where camera continues running
    
    // Set stopping state
    setIsStopping(true);
    setStatusMessage('Stopping camera...');
    
    // Force stop all camera usage immediately
    releaseCamera().then(() => {
      // Update states after camera is released
      if (isMounted.current) {
        setScanning(false);
        setIsStartingCamera(false);
        setIsStopping(false);
        setSuccess('Scanner stopped.');
        setStatusMessage('');
      }
    }).catch(err => {
      console.error('Error stopping scanner:', err);
      if (isMounted.current) {
        setScanning(false);
        setIsStartingCamera(false);
        setIsStopping(false);
        setError('Error stopping scanner. Camera has been released.');
        setStatusMessage('');
      }
    });
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      {/* Hidden element for camera preloading */}
      <div id="reader-hidden" style={{ position: 'absolute', width: '0px', height: '0px', overflow: 'hidden' }}></div>
      <Grid container spacing={3}>
        {/* Stats Cards */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" component="div" gutterBottom>
                Today's Sales
              </Typography>
              {loading ? (
                <CircularProgress size={24} />
              ) : (
                <Typography variant="h4">
                  ₹{(dailyStats.totalSales || 0).toFixed(2)}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" component="div" gutterBottom>
                Today's Transactions
              </Typography>
              {loading ? (
                <CircularProgress size={24} />
              ) : (
                <Typography variant="h4">
                  {dailyStats.totalTransactions || 0}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" component="div" gutterBottom>
                Pending Settlement
              </Typography>
              {loading ? (
                <CircularProgress size={24} />
              ) : (
                <Typography variant="h4">
                  ₹{(dailyStats.pendingSettlement || 0).toFixed(2)}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* QR Scanner Section */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  Scan Student ID
                </Typography>
                <LoadingButton
                  variant="contained"
                  onClick={scanning ? stopScanning : startScanning}
                  color={scanning ? "error" : "primary"}
                  startIcon={scanning ? <StopIcon /> : <QrCodeScannerIcon />}
                  loading={isStartingCamera || isStopping}
                  disabled={isStartingCamera || isStopping || (scanning && stopDisabled)}
                >
                  {isStartingCamera ? "Starting Camera..." : 
                   isStopping ? "Stopping Camera..." : 
                   scanning ? (stopDisabled ? "Please wait..." : "Stop Scanning") : "Start Scanning"}
                </LoadingButton>
              </Box>
              
              <Box 
                sx={{ 
                  width: '100%', 
                  maxWidth: 500, 
                  mx: 'auto', 
                  my: 2,
                  display: scanning ? 'block' : 'none',
                  position: 'relative',
                  '& #reader': {
                    border: '1px solid #ccc',
                    borderRadius: 1,
                    overflow: 'hidden',
                    minHeight: '300px'
                  }
                }}
              >
                <div id="reader"></div>
                {isStartingCamera && (
                  <Box sx={{ 
                    position: 'absolute', 
                    top: '50%', 
                    left: '50%', 
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    zIndex: 10,
                    backgroundColor: 'rgba(255,255,255,0.8)',
                    padding: 3,
                    borderRadius: 2
                  }}>
                    <CircularProgress size={60} />
                    <Typography variant="body1" sx={{ mt: 2 }}>
                      Starting camera...
                    </Typography>
                  </Box>
                )}
              </Box>

              {error && (
                <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError('')}>
                  {error}
                </Alert>
              )}

              {statusMessage && (
                <Alert severity="info" sx={{ mt: 2, fontSize: '1.1rem', fontWeight: 'bold' }}>
                  {statusMessage}
                </Alert>
              )}
              
              {success && !statusMessage && (
                <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSuccess('')}>
                  {success}
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Transaction Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={() => !processing && setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Process Transaction</DialogTitle>
        <DialogContent>
          {studentData && (
            <Box sx={{ pt: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Student Name: {studentData.student_name}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                Balance: ₹{parseFloat(studentData.balance || 0).toFixed(2)}
              </Typography>
              <Typography variant="subtitle1" gutterBottom>
                Daily Limit Remaining: ₹{((studentData.daily_limit || 0) - (studentData.daily_spent || 0)).toFixed(2)}
              </Typography>
              <TextField
                autoFocus
                margin="dense"
                label="Amount"
                type="number"
                fullWidth
                variant="outlined"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={processing}
                InputProps={{
                  startAdornment: <InputAdornment position="start">₹</InputAdornment>
                }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={processing}>
            Cancel
          </Button>
          <LoadingButton
            onClick={handleTransaction}
            loading={processing}
            disabled={!amount || parseFloat(amount) <= 0}
            variant="contained"
          >
            Process Transaction
          </LoadingButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Dashboard;
