import { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Box,
  Chip,
} from '@mui/material';
import {
  Payment as PaymentIcon,
} from '@mui/icons-material';
import axios from 'axios';

const SettlementManagement = () => {
  const [settlements, setSettlements] = useState([]);
  const [selectedSettlement, setSelectedSettlement] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettlements();
  }, []);

  const fetchSettlements = async () => {
    try {
      setLoading(true);
      console.log('Fetching settlements...');
      const response = await axios.get('http://localhost:5000/api/settlements', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      console.log('Fetched settlements:', response.data);
      setSettlements(response.data);
    } catch (error) {
      console.error('Error fetching settlements:', error.response?.data || error);
      setError('Failed to fetch settlements');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentClick = (settlement) => {
    setSelectedSettlement(settlement);
    // Set the payment amount to the exact requested amount
    setPaymentAmount(settlement.total_transaction_amount.toString());
    setError('');
  };

  const handlePayment = async () => {
    const amount = parseFloat(selectedSettlement.total_transaction_amount);

    if (!amount || amount <= 0) {
      setError('Invalid settlement amount');
      return;
    }

    try {
      console.log('Processing payment:', {
        settlementId: selectedSettlement.settlement_id,
        amount: parseFloat(paymentAmount)
      });

      const response = await axios.post(
        `http://localhost:5000/api/settlements/${selectedSettlement.settlement_id}/pay`,
        {
          amount: amount,
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      console.log('Payment response:', response.data);
      const updatedSettlement = response.data;
      
      // Update the settlements list immediately
      setSettlements(prevSettlements => {
        const newSettlements = prevSettlements.map(settlement => {
          if (settlement.settlement_id === updatedSettlement.settlement_id) {
            // Ensure amounts are properly formatted
            const updated = {
              ...updatedSettlement,
              settled_amount: parseFloat(updatedSettlement.settled_amount),
              pending_amount: parseFloat(updatedSettlement.pending_amount),
              total_transaction_amount: parseFloat(updatedSettlement.total_transaction_amount)
            };
            console.log('Updated settlement:', updated);
            return updated;
          }
          return settlement;
        });
        console.log('New settlements list:', newSettlements);
        return newSettlements;
      });

      setSuccess(`Successfully processed payment of ₹${paymentAmount}`);
      setSelectedSettlement(null);

      // Fetch fresh data after a short delay
      setTimeout(() => {
        fetchSettlements();
      }, 1000);
    } catch (error) {
      console.error('Payment error:', error.response?.data || error);
      setError(error.response?.data?.error || 'Payment processing failed');
    }
  };

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'warning';
      case 'completed':
        return 'success';
      case 'partially_paid':
        return 'info';
      default:
        return 'default';
    }
  };

  const isPaymentDisabled = (settlement) => {
    return settlement.status.toLowerCase() === 'completed' || 
           Math.abs(settlement.pending_amount) <= 0.01;
  };

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" sx={{ mb: 4, textAlign: 'center' }}>
        Settlement Management
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Store Name</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell align="right">Total Amount</TableCell>
              <TableCell align="right">Settled Amount</TableCell>
              <TableCell align="right">Pending Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} align="center">Loading...</TableCell>
              </TableRow>
            ) : settlements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">No settlements found</TableCell>
              </TableRow>
            ) : (
              settlements.map((settlement) => (
                <TableRow key={settlement.settlement_id}>
                  <TableCell>{settlement.store_name}</TableCell>
                  <TableCell>{settlement.owner_name}</TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2">{settlement.email}</Typography>
                      <Typography variant="body2" color="textSecondary">
                        {settlement.mobile_number}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right">₹{settlement.total_transaction_amount}</TableCell>
                  <TableCell align="right">₹{settlement.settled_amount}</TableCell>
                  <TableCell align="right">₹{settlement.pending_amount}</TableCell>
                  <TableCell>
                    <Chip
                      label={settlement.status}
                      color={getStatusColor(settlement.status)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {!isPaymentDisabled(settlement) ? (
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<PaymentIcon />}
                        onClick={() => handlePaymentClick(settlement)}
                      >
                        Pay
                      </Button>
                    ) : (
                      <Typography variant="body2" color="textSecondary">
                        {settlement.status === 'completed' ? 'Settled' : ''}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!selectedSettlement} onClose={() => setSelectedSettlement(null)}>
        <DialogTitle>Confirm Settlement Payment</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2, mt: 2 }}>
            <Typography variant="subtitle1">
              Store: {selectedSettlement?.store_name}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Pending Amount: ₹{selectedSettlement?.pending_amount}
            </Typography>
          </Box>
          <TextField
            margin="dense"
            label="Settlement Amount"
            type="number"
            fullWidth
            value={paymentAmount}
            disabled
            InputProps={{
              startAdornment: '₹',
              readOnly: true
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedSettlement(null)}>Cancel</Button>
          <Button onClick={handlePayment} variant="contained" color="primary">
            Confirm & Pay
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default SettlementManagement;
