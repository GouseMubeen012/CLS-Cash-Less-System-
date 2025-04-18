import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  useTheme,
  useMediaQuery,
  Chip,
} from '@mui/material';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import io from 'socket.io-client';
import config from '../config';
import { useNavigate } from 'react-router-dom';

const Settlements = () => {
  const [settlements, setSettlements] = useState([]);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [settledAmount, setSettledAmount] = useState(0);
  const [requestedAmount, setRequestedAmount] = useState(0);
  const [completedAmount, setCompletedAmount] = useState(0);
  const [settlementAmount, setSettlementAmount] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();

  const fetchSettlements = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token || !user?.storeId) {
        navigate('/login');
        return;
      }

      const storeId = parseInt(user.storeId, 10);
      if (isNaN(storeId)) {
        console.error('Invalid store ID');
        navigate('/login');
        return;
      }

      const response = await axios.get(`${config.API_URL}/api/settlements/store/${storeId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      // Verify the response structure
      if (Array.isArray(response.data)) {
        setSettlements(response.data);
      } else {
        console.error('Invalid settlements data format');
        setSettlements([]);
      }
    } catch (error) {
      console.error('Error fetching settlements:', error);
      if (error.response?.status === 401 || error.response?.status === 403) {
        // Clear auth data and redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        delete axios.defaults.headers.common['Authorization'];
        navigate('/login');
      } else {
        setError('Failed to fetch settlements. Please try again.');
      }
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  }, [user?.storeId, navigate]);

  const fetchPendingAmount = useCallback(async () => {
    try {
      if (!user || !user.storeId) {
        navigate('/login');
        return;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const storeId = parseInt(user.storeId, 10);
      if (isNaN(storeId)) {
        console.error('Invalid store ID');
        navigate('/login');
        return;
      }

      // First verify token
      const verifyResponse = await axios.get(`${config.API_URL}/api/store/verify-token`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!verifyResponse.data.valid) {
        throw new Error('Invalid token');
      }

      const response = await axios.get(`${config.API_URL}/api/store/pending-settlement/${storeId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const { amount, totalAmount, settledAmount, requestedAmount, completedAmount } = response.data;
      setPendingAmount(amount || 0);
      setTotalAmount(totalAmount || 0);
      setSettledAmount(settledAmount || 0);
      setRequestedAmount(requestedAmount || 0);
      setCompletedAmount(completedAmount || 0);
      
      return response.data;
    } catch (error) {
      console.error('Error fetching pending amount:', error);
      if (error.response?.status === 401 || error.response?.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        delete axios.defaults.headers.common['Authorization'];
        navigate('/login');
      }
      throw error;
    }
  }, [user, navigate]);

  // Handle settlement request
  const handleSettlementRequest = async () => {
    try {
      setProcessing(true);
      setError('');

      const response = await axios.post(`${config.API_URL}/api/settlements/request`, {
        amount: parseFloat(settlementAmount)
      });

      // Update state with the response data
      const { amounts, settlement } = response.data;
      setPendingAmount(amounts.pending);
      setTotalAmount(amounts.total);
      setSettledAmount(amounts.settled);
      setRequestedAmount(amounts.requested);
      setCompletedAmount(amounts.completed);

      // Add new settlement to the list
      setSettlements(prevSettlements => [settlement, ...prevSettlements]);

      // Reset form
      setSettlementAmount('');
      setDialogOpen(false);
      setSuccess('Settlement request submitted successfully');
    } catch (error) {
      console.error('Error requesting settlement:', error);
      setError(error.response?.data?.error || 'Failed to submit settlement request');
    } finally {
      setProcessing(false);
    }
  };

  // Socket connection useEffect
  useEffect(() => {
    let socket = null;
    let reconnectTimer = null;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    
    const connectSocket = () => {
      if (socket?.connected) return;

      // Clear any existing socket
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }

      socket = io(config.SOCKET_URL, {
        auth: { token: localStorage.getItem('token') },
        extraHeaders: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        reconnection: true,
        reconnectionAttempts: MAX_RETRIES,
        reconnectionDelay: 1000,
        transports: ['polling', 'websocket'],
        withCredentials: true,
        timeout: 10000,
        forceNew: true
      });

      socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        retryCount = 0; // Reset retry count on successful connection
      });

      socket.on('settlementUpdate', (data) => {
        console.log('Received settlement update:', data);
        if (!data || !data.data) return;

        const { amount, totalAmount, settledAmount, requestedAmount, completedAmount, settlement } = data.data;

        // Update amounts atomically to ensure consistency
        const newAmounts = {
          pending: amount || 0,
          total: totalAmount || 0,
          settled: settledAmount || 0,
          requested: requestedAmount || 0,
          completed: completedAmount || 0
        };

        setPendingAmount(newAmounts.pending);
        setTotalAmount(newAmounts.total);
        setSettledAmount(newAmounts.settled);
        setRequestedAmount(newAmounts.requested);
        setCompletedAmount(newAmounts.completed);

        // Update settlements list based on type
        if (data.type === 'settlement_request' && settlement) {
          setSettlements(prevSettlements => {
            // Remove any existing settlement with the same ID
            const filteredSettlements = prevSettlements.filter(s => s.settlement_id !== settlement.settlement_id);
            // Add new settlement at the beginning
            return [settlement, ...filteredSettlements];
          });
        } else if (data.type === 'settlement_paid' && settlement) {
          setSettlements(prevSettlements => 
            prevSettlements.map(s => 
              s.settlement_id === settlement.settlement_id 
                ? settlement 
                : s
            )
          );
        }
      });
    };

    // Initial connection
    connectSocket();

    // Cleanup function
    return () => {
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
      }
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [navigate, fetchSettlements, fetchPendingAmount]);

  // Initial data fetch useEffect
  useEffect(() => {
    let mounted = true;
    const fetchInitialData = async () => {
      if (!user || !user.storeId) {
        navigate('/login');
        return;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        setLoading(true);
        setError('');

        // Set default auth header
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        // Fetch both data in parallel
        const [pendingData, settlementsData] = await Promise.all([
          fetchPendingAmount(),
          fetchSettlements()
        ]);

        // Only update state if component is still mounted
        if (mounted && pendingData) {
          setPendingAmount(pendingData.amount || 0);
          setTotalAmount(pendingData.totalAmount || 0);
          setSettledAmount(pendingData.settledAmount || 0);
          setRequestedAmount(pendingData.requestedAmount || 0);
          setCompletedAmount(pendingData.completedAmount || 0);
        }
      } catch (error) {
        console.error('Error fetching initial data:', error);
        if (mounted) {
          setError('Failed to load data. Please refresh the page.');
          if (error.response?.status === 401 || error.response?.status === 403) {
            navigate('/login');
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchInitialData();

    // Cleanup function
    return () => {
      mounted = false;
    };
  }, [user, fetchSettlements, fetchPendingAmount, navigate]);

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={3}>
        {error && (
          <Grid item xs={12}>
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          </Grid>
        )}
        {success && (
          <Grid item xs={12}>
            <Alert severity="success" onClose={() => setSuccess('')}>
              {success}
            </Alert>
          </Grid>
        )}
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4">Settlements</Typography>
          </Box>
        </Grid>

        {/* Pending Settlement Card */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Pending Settlement
              </Typography>
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  <Typography variant="h4" color="primary" gutterBottom>
                    ₹{(pendingAmount || 0).toFixed(2)}
                  </Typography>
                  {requestedAmount > 0 && (
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      (₹{requestedAmount.toFixed(2)} pending approval)
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    onClick={() => setDialogOpen(true)}
                    disabled={!pendingAmount || pendingAmount <= 0}
                    sx={{ mt: 2 }}
                  >
                    Request Settlement
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Settlement History */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Settlement History
              </Typography>
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date & Time</TableCell>
                      <TableCell>Amount</TableCell>
                      {!isMobile && <TableCell>Reference ID</TableCell>}
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={isMobile ? 3 : 4} align="center">
                          <CircularProgress size={24} />
                        </TableCell>
                      </TableRow>
                    ) : settlements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isMobile ? 3 : 4} align="center">
                          No settlements found
                        </TableCell>
                      </TableRow>
                    ) : (
                      settlements.map((settlement, index) => (
                        <TableRow 
                          key={`${settlement.settlement_id}_${index}_${Date.now()}`}
                        >
                          <TableCell>
                            {format(new Date(settlement.created_at), 'MMM dd, yyyy HH:mm')}
                          </TableCell>
                          <TableCell>
                            <Box>
                              <Typography>₹{settlement.total_transaction_amount}</Typography>
                              {settlement.status === 'completed' && (
                                <Typography variant="caption" color="textSecondary">
                                  Settled: ₹{settlement.settled_amount}
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          {!isMobile && (
                            <TableCell>{settlement.reference_id || '-'}</TableCell>
                          )}
                          <TableCell>
                            <Chip
                              label={settlement.status}
                              color={
                                settlement.status === 'completed'
                                  ? 'success'
                                  : settlement.status === 'pending'
                                  ? 'warning'
                                  : 'default'
                              }
                              size="small"
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Settlement Request Dialog */}
      <Dialog open={dialogOpen} onClose={() => !processing && setDialogOpen(false)}>
        <DialogTitle>Request Settlement</DialogTitle>
        <DialogContent>
          <Box sx={{ minWidth: 300, mt: 2 }}>
            <TextField
              fullWidth
              label="Settlement Amount"
              type="number"
              value={settlementAmount}
              onChange={(e) => setSettlementAmount(e.target.value)}
              disabled={processing}
              InputProps={{
                inputProps: {
                  min: 0,
                  max: pendingAmount,
                },
              }}
            />
            <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
              Maximum available amount: ₹{pendingAmount.toFixed(2)}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={processing}>
            Cancel
          </Button>
          <Button
            onClick={handleSettlementRequest}
            variant="contained"
            disabled={
              processing ||
              !settlementAmount ||
              parseFloat(settlementAmount) <= 0 ||
              parseFloat(settlementAmount) > pendingAmount
            }
            startIcon={processing && <CircularProgress size={20} />}
          >
            {processing ? 'Processing...' : 'Submit Request'}
          </Button>
        </DialogActions>
      </Dialog>

      {success && (
        <Alert
          severity="success"
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 2000,
          }}
        >
          {success}
        </Alert>
      )}

      {error && (
        <Alert
          severity="error"
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 2000,
          }}
        >
          {error}
        </Alert>
      )}
    </Box>
  );
};

export default Settlements;
