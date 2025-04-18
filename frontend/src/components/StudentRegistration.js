import { useState } from 'react';
import DownloadIcon from '@mui/icons-material/Download';
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

const StudentRegistration = () => {
  const [formData, setFormData] = useState({
    student_name: '',
    class: '',
    father_name: '',
    photo: null,
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [registeredStudent, setRegisteredStudent] = useState(null);

  const handleChange = (e) => {
    if (e.target.name === 'photo') {
      setFormData({
        ...formData,
        photo: e.target.files[0],
      });
    } else {
      setFormData({
        ...formData,
        [e.target.name]: e.target.value,
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    try {
      const formDataToSend = new FormData();
      Object.keys(formData).forEach(key => {
        formDataToSend.append(key, formData[key]);
      });

      const response = await axios.post(
        'http://localhost:5000/api/students',
        formDataToSend,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      setRegisteredStudent(response.data);
      setSuccess(true);
      setFormData({
        student_name: '',
        class: '',
        father_name: '',
        photo: null,
      });
    } catch (error) {
      console.error('Student registration error:', error);
      console.log('Error response:', error.response);
      
      if (error.response && error.response.data && error.response.data.error) {
        setError(error.response.data.error);
      } else {
        setError('Registration failed. Please try again or contact support.');
      }
    }
  };

  const handleDownloadIDCard = async () => {
    try {
      const response = await axios.get(
        `http://localhost:5000/api/students/${registeredStudent.student_id}/id-card`,
        {
          responseType: 'blob',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${registeredStudent.student_name}_ID_Card.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading ID card:', error);
      setError('Failed to download ID card');
    }
  };

  return (
    <Container maxWidth="md">
      <Typography variant="h4" sx={{ mb: 4, textAlign: 'center' }}>
        Student Registration
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
              Student registered successfully!
            </Alert>
          )}

          <TextField
            margin="normal"
            required
            fullWidth
            label="Student Name"
            name="student_name"
            value={formData.student_name}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            label="Class"
            name="class"
            value={formData.class}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            label="Father's Name"
            name="father_name"
            value={formData.father_name}
            onChange={handleChange}
          />
          <Box sx={{ mt: 2, mb: 2 }}>
            <input
              accept="image/*"
              style={{ display: 'none' }}
              id="photo-upload"
              type="file"
              name="photo"
              onChange={handleChange}
              required
            />
            <label htmlFor="photo-upload">
              <Button variant="outlined" component="span">
                Upload Photo
              </Button>
            </label>
            {formData.photo && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                Selected file: {formData.photo.name}
              </Typography>
            )}
          </Box>
          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{ mt: 2 }}
          >
            Register Student
          </Button>
        </Paper>
      </Box>

      {registeredStudent && (
        <Card sx={{ mt: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="h6" gutterBottom>
                Student Registration Successful!
              </Typography>
              
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Typography variant="body1" align="center">
                  Student has been registered successfully. Click below to download their ID card.
                </Typography>
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
                  <Typography variant="body1">
                    <strong>Name:</strong> {registeredStudent.student_name}
                  </Typography>
                  <Typography variant="body1">
                    <strong>ID:</strong> {registeredStudent.student_id}
                  </Typography>
                  <Typography variant="body1">
                    <strong>Class:</strong> {registeredStudent.class}
                  </Typography>
                  <Typography variant="body1">
                    <strong>Father's Name:</strong> {registeredStudent.father_name}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 2 }}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleDownloadIDCard}
                    startIcon={<DownloadIcon />}
                  >
                    Download ID Card
                  </Button>
                </Box>
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}
    </Container>
  );
};

export default StudentRegistration;
