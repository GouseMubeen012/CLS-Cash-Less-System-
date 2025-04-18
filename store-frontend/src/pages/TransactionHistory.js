import React, { useState, useEffect, useCallback } from 'react';
import config from '../config';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  useTheme,
  useMediaQuery,
  IconButton,
  TablePagination,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
// Download icon removed
import { useNavigate } from 'react-router-dom';

const TransactionHistory = () => {
  const [transactions, setTransactions] = useState([]);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalAmount, setTotalAmount] = useState(0);
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();

  const fetchTransactions = useCallback(async () => {
    try {
      const storeId = parseInt(user.storeId, 10);
      console.log('Fetching transactions with params:', {
        storeId,
        startDate: format(startDate, 'yyyy-MM-dd'),
        endDate: format(endDate, 'yyyy-MM-dd')
      });

      const response = await axios.get(`${config.API_URL}/api/stores/${storeId}/transactions`, {
        params: {
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd')
        }
      });

      const { transactions, totalAmount } = response.data;
      console.log('Received transactions:', transactions);
      setTransactions(transactions || []);
      setTotalAmount(totalAmount || 0);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      if (error.response?.status === 401 || error.response?.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        delete axios.defaults.headers.common['Authorization'];
        navigate('/login');
      }
    }
  }, [user.storeId, startDate, endDate, navigate]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const downloadTransactions = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/store/transactions/download', {
        params: {
          storeId: user.storeId,
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd'),
        },
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `transactions_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error downloading transactions:', error);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Box sx={{ mb: 3 }}>
            <Typography variant="h4">Transaction History</Typography>
          </Box>
        </Grid>

        <Grid item xs={12}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={4}>
                  <LocalizationProvider dateAdapter={AdapterDateFns}>
                    <DatePicker
                      label="Start Date"
                      value={startDate}
                      onChange={(newValue) => setStartDate(newValue)}
                      renderInput={(params) => <TextField {...params} fullWidth />}
                    />
                  </LocalizationProvider>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <LocalizationProvider dateAdapter={AdapterDateFns}>
                    <DatePicker
                      label="End Date"
                      value={endDate}
                      onChange={(newValue) => setEndDate(newValue)}
                      renderInput={(params) => <TextField {...params} fullWidth />}
                    />
                  </LocalizationProvider>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="h6">
                    Total Amount: ₹{parseFloat(totalAmount || 0).toFixed(2)}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Date & Time</TableCell>
                  {!isMobile && (
                    <>
                      <TableCell>Student Name</TableCell>
                      <TableCell>Class</TableCell>
                    </>
                  )}
                  <TableCell>Amount</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((transaction) => (
                    <TableRow key={transaction.transaction_id}>
                      <TableCell>
                        {format(new Date(transaction.created_at), 'dd/MM/yyyy HH:mm')}
                      </TableCell>
                      {!isMobile && (
                        <>
                          <TableCell>{transaction.student_name}</TableCell>
                          <TableCell>{transaction.class}</TableCell>
                        </>
                      )}
                      <TableCell>₹{parseFloat(transaction.amount || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <Typography
                          sx={{
                            color: transaction.status === 'completed' ? 'success.main' : 'warning.main',
                          }}
                        >
                          {transaction.status}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            <TablePagination
              rowsPerPageOptions={[5, 10, 25]}
              component="div"
              count={transactions.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={handleChangePage}
              onRowsPerPageChange={handleChangeRowsPerPage}
            />
          </TableContainer>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TransactionHistory;
