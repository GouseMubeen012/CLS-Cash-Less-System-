import { useState } from 'react';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  Card,
  CardContent,
} from '@mui/material';
import axios from 'axios';

const StoreRegistration = () => {
  const [formData, setFormData] = useState({
    store_name: '',
    store_type: '',
    owner_name: '',
    mobile_number: '',
    email: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [registeredStore, setRegisteredStore] = useState(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    try {
      const response = await axios.post(
        'http://localhost:5000/api/stores',
        formData,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      setRegisteredStore(response.data);
      setSuccess(true);
      setFormData({
        store_name: '',
        store_type: '',
        owner_name: '',
        mobile_number: '',
        email: '',
      });

      // Open credentials PDF in new window
      if (response.data.credentials.pdfUrl) {
        window.open(`http://localhost:5000${response.data.credentials.pdfUrl}`, '_blank');
      }
    } catch (error) {
      console.error('Store registration error:', error);
      console.log('Error response:', error.response);
      
      if (error.response && error.response.data && error.response.data.error) {
        setError(error.response.data.error);
      } else {
        setError('Registration failed. Please try again or contact support.');
      }
    }
  };

  return (
    <Container maxWidth="md">
      <Typography variant="h4" sx={{ mb: 4, textAlign: 'center' }}>
        Store Registration
      </Typography>

      <Box component="form" onSubmit={handleSubmit}>
        <Paper elevation={3} sx={{ p: 4, mb: 4 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Store registered successfully! Credentials have been opened in a new window.
            </Alert>
          )}

          <TextField
            margin="normal"
            required
            fullWidth
            label="Store Name"
            name="store_name"
            value={formData.store_name}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            label="Store Type"
            name="store_type"
            value={formData.store_type}
            onChange={handleChange}
            placeholder="e.g., Cafeteria, Bookstore, Stationery"
          />
          <TextField
            margin="normal"
            required
            fullWidth
            label="Owner Name"
            name="owner_name"
            value={formData.owner_name}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            label="Mobile Number"
            name="mobile_number"
            value={formData.mobile_number}
            onChange={handleChange}
            inputProps={{ pattern: '[0-9]{10}' }}
            placeholder="10-digit mobile number"
          />
          <TextField
            margin="normal"
            required
            fullWidth
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 3 }}
          >
            Register Store
          </Button>
        </Paper>
      </Box>

      {registeredStore && (
        <Card sx={{ mt: 4 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Store Registration Details
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Typography variant="body1">
                <strong>Store ID:</strong> {registeredStore.store.store_id}
              </Typography>
              <Typography variant="body1">
                <strong>Store Name:</strong> {registeredStore.store.store_name}
              </Typography>
              <Typography variant="body1">
                <strong>Store Type:</strong> {registeredStore.store.store_type}
              </Typography>
              <Typography variant="body1">
                <strong>Owner Name:</strong> {registeredStore.store.owner_name}
              </Typography>
              <Typography variant="body1">
                <strong>Mobile:</strong> {registeredStore.store.mobile_number}
              </Typography>
              <Typography variant="body1">
                <strong>Email:</strong> {registeredStore.store.email}
              </Typography>
              <Typography variant="body1" sx={{ mt: 2, color: 'primary.main' }}>
                Store credentials have been opened in a new window.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Please save or print the credentials PDF for your records.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}
    </Container>
  );
};

export default StoreRegistration;
