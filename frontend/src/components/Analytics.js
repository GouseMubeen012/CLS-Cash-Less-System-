import { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Paper,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import axios from 'axios';

const Analytics = () => {
  const [dailyTransactions, setDailyTransactions] = useState([]);
  const [storeSales, setStoreSales] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [dailyData, salesData] = await Promise.all([
          axios.get('http://localhost:5000/api/analytics/daily-transactions', {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          }),
          axios.get('http://localhost:5000/api/analytics/store-sales', {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          }),
        ]);

        setDailyTransactions(dailyData.data);
        setStoreSales(salesData.data);
      } catch (error) {
        setError('Failed to fetch analytics data');
        console.error('Error fetching analytics:', error);
      }
    };

    fetchData();
  }, []);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom component="h1" sx={{ mb: 4 }}>
        Analytics Dashboard
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Daily Transactions Chart */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 400 }}>
            <Typography variant="h6" gutterBottom>
              Daily Transactions (Last 30 Days)
            </Typography>
            <ResponsiveContainer>
              <LineChart
                data={dailyTransactions}
                margin={{
                  top: 16,
                  right: 30,
                  bottom: 20,
                  left: 24,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => new Date(date).toLocaleDateString()}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis 
                  yAxisId="left" 
                  orientation="left" 
                  stroke="#8884d8"
                  tickFormatter={(value) => Math.round(value)}
                  domain={[0, 'auto']}
                  label={{ value: 'Number of Transactions', angle: -90, position: 'insideLeft' }}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  stroke="#82ca9d"
                  tickFormatter={(value) => `₹${value}`}
                  domain={[0, 'auto']}
                  label={{ value: 'Total Amount (₹)', angle: 90, position: 'insideRight' }}
                />
                <Tooltip
                  labelFormatter={(date) => new Date(date).toLocaleDateString()}
                  formatter={(value, name) => {
                    if (name === 'Total Amount') return [`₹${value.toFixed(2)}`, name];
                    return [value, name];
                  }}
                />
                <Legend verticalAlign="top" height={36}/>
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="transaction_count"
                  stroke="#8884d8"
                  name="Number of Transactions"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="total_amount"
                  stroke="#82ca9d"
                  name="Total Amount"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Store Sales Chart */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 400 }}>
            <Typography variant="h6" gutterBottom>
              Store Sales Analysis
            </Typography>
            <ResponsiveContainer>
              <BarChart
                data={storeSales}
                margin={{
                  top: 16,
                  right: 16,
                  bottom: 0,
                  left: 24,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="store_name" />
                <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'total_sales') return [`₹${value}`, 'Total Sales'];
                    return [value, 'Transaction Count'];
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="transaction_count"
                  fill="#8884d8"
                  name="Number of Transactions"
                />
                <Bar
                  yAxisId="right"
                  dataKey="total_sales"
                  fill="#82ca9d"
                  name="Total Sales"
                />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Store Sales Table */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" gutterBottom>
              Detailed Store Performance
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Store Name</TableCell>
                    <TableCell align="right">Transaction Count</TableCell>
                    <TableCell align="right">Total Sales</TableCell>
                    <TableCell align="right">Average Transaction Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {storeSales.map((store) => (
                    <TableRow key={store.store_name}>
                      <TableCell>{store.store_name}</TableCell>
                      <TableCell align="right">{store.transaction_count}</TableCell>
                      <TableCell align="right">₹{store.total_sales}</TableCell>
                      <TableCell align="right">
                        ₹{store.transaction_count ? (store.total_sales / store.transaction_count).toFixed(2) : '0.00'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Analytics;
