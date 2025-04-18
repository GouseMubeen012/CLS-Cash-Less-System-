import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  Tabs,
  Tab,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import axios from 'axios';

const RechargeManagement = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [allStudents, setAllStudents] = useState([]);

  const searchTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  const lastDataRef = useRef(null);
  const pollingRef = useRef(null);

  // Separate functions for fetching all students and searching
  const fetchAllStudents = useCallback(async () => {
    try {
      if (loading || isSearchActive) return; // Don't fetch all if we're searching
      
      setLoading(true);
      
      const response = await axios.get('http://localhost:5000/api/students', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      // If component is unmounted, don't update state
      if (!isMountedRef.current) return;

      // Get latest balance for each student
      const studentsWithBalance = await Promise.all(response.data.map(async (student) => {
        try {
          const balanceResponse = await axios.get(`http://localhost:5000/api/students/${student.student_id}/balance`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          });
          return { ...student, balance: balanceResponse.data.balance };
        } catch (error) {
          // If balance fetch fails, return student with 0 balance
          return { ...student, balance: 0 };
        }
      }));

      // Only update if data has changed
      const newDataString = JSON.stringify(studentsWithBalance);
      if (newDataString !== lastDataRef.current) {
        lastDataRef.current = newDataString;
        setAllStudents(studentsWithBalance);
        
        // Only update displayed students if not in search mode
        if (!isSearchActive) {
          setStudents(studentsWithBalance);
        }
      }
    } catch (error) {
      if (isMountedRef.current) {
        setError('Failed to fetch students');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [loading, isSearchActive]);

  const searchStudents = useCallback(async (query) => {
    if (!query) {
      setIsSearchActive(false);
      setStudents(allStudents);
      return;
    }
    
    try {
      setIsSearchActive(true);
      setLoading(true);
      
      const response = await axios.get(`http://localhost:5000/api/students?search=${query}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      // If component is unmounted, don't update state
      if (!isMountedRef.current) return;

      // Get latest balance for each student
      const studentsWithBalance = await Promise.all(response.data.map(async (student) => {
        try {
          const balanceResponse = await axios.get(`http://localhost:5000/api/students/${student.student_id}/balance`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          });
          return { ...student, balance: balanceResponse.data.balance };
        } catch (error) {
          // If balance fetch fails, return student with 0 balance
          return { ...student, balance: 0 };
        }
      }));

      // Always update search results
      setStudents(studentsWithBalance);
    } catch (error) {
      if (isMountedRef.current) {
        setError('Failed to search students');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [allStudents]);

  // Set isMounted flag on component mount/unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear any pending timeouts on unmount
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Fetch initial data
  useEffect(() => {
    fetchAllStudents();
    
    // Setup polling with longer interval (10 seconds)
    pollingRef.current = setInterval(() => {
      // Only fetch all students if not in search mode
      if (isMountedRef.current && !isSearchActive) {
        fetchAllStudents();
      }
    }, 10000);
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchAllStudents, isSearchActive]);

  // Debounced search handler
  const handleSearch = useCallback((e) => {
    const query = e.target.value;
    setSearchQuery(query);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for search
    if (query.length >= 3 || query.length === 0) {
      searchTimeoutRef.current = setTimeout(() => {
        searchStudents(query);
      }, 500); // Wait 500ms after user stops typing
    }
  }, [searchStudents]);

  const handleRechargeClick = (student) => {
    setSelectedStudent(student);
    setRechargeAmount('');
    setError('');
  };

  const handleDailyLimitClick = (student) => {
    setSelectedStudent(student);
    setDailyLimit(student.daily_limit?.toString() || '');
    setError('');
  };

  const handleRecharge = async () => {
    if (!rechargeAmount || parseFloat(rechargeAmount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    try {
      const response = await axios.post(
        'http://localhost:5000/api/recharge',
        {
          student_id: selectedStudent.student_id,
          amount: parseFloat(rechargeAmount),
          recharge_type: 'credit',
          notes: 'Account recharge'
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      // Update the student's balance in both state arrays
      const updateStudentBalance = (studentArray) => {
        return studentArray.map(student => {
          if (student.student_id === selectedStudent.student_id) {
            return {
              ...student,
              balance: response.data.new_balance
            };
          }
          return student;
        });
      };
      
      setStudents(updateStudentBalance(students));
      setAllStudents(updateStudentBalance(allStudents));
      
      setSuccess(`Successfully recharged ₹${rechargeAmount} for ${selectedStudent.student_name}. New balance: ₹${response.data.new_balance}`);
      setSelectedStudent(null);
      setRechargeAmount('');
    } catch (error) {
      setError(error.response?.data?.error || 'Recharge failed');
    }
  };

  const handleSetDailyLimit = async () => {
    if (!dailyLimit || parseFloat(dailyLimit) < 0) {
      setError('Please enter a valid daily limit amount');
      return;
    }

    try {
      await axios.post(
        `http://localhost:5000/api/students/${selectedStudent.student_id}/daily-limit`,
        {
          daily_limit: parseFloat(dailyLimit)
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );

      // Update the daily limit in both state arrays
      const updateStudentDailyLimit = (studentArray) => {
        return studentArray.map(student => {
          if (student.student_id === selectedStudent.student_id) {
            return {
              ...student,
              daily_limit: parseFloat(dailyLimit)
            };
          }
          return student;
        });
      };
      
      setStudents(updateStudentDailyLimit(students));
      setAllStudents(updateStudentDailyLimit(allStudents));

      setSuccess(`Successfully set daily limit to ₹${dailyLimit} for ${selectedStudent.student_name}`);
      setSelectedStudent(null);
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to set daily limit');
    }
  };

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" sx={{ mb: 4, textAlign: 'center' }}>
        Recharge Management
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

      <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
            <Tab label="Recharge" />
            <Tab label="Daily Limit" />
          </Tabs>
        </Box>

        <TextField
          fullWidth
          label="Search Students"
          variant="outlined"
          value={searchQuery}
          onChange={handleSearch}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          helperText="Search by Student Name"
        />
      </Paper>

      <TableContainer component={Paper} sx={{ minHeight: '300px' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Student ID</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Class</TableCell>
              <TableCell>Current Balance</TableCell>
              {activeTab === 1 && <TableCell>Daily Limit</TableCell>}
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {students.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeTab === 1 ? 6 : 5} align="center">
                  {loading ? 'Loading...' : 'No students found'}
                </TableCell>
              </TableRow>
            ) : (
              students.map((student) => (
                <TableRow key={student.student_id}>
                  <TableCell>{student.student_id}</TableCell>
                  <TableCell>{student.student_name}</TableCell>
                  <TableCell>{student.class}</TableCell>
                  <TableCell>₹{student.balance || 0}</TableCell>
                  {activeTab === 1 && (
                    <TableCell>₹{student.daily_limit || 0}</TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => activeTab === 0 ? handleRechargeClick(student) : handleDailyLimitClick(student)}
                    >
                      {activeTab === 0 ? 'Recharge' : 'Set Limit'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Recharge Dialog */}
      <Dialog 
        open={!!selectedStudent && activeTab === 0} 
        onClose={() => setSelectedStudent(null)}
      >
        <DialogTitle>
          Recharge for {selectedStudent?.student_name}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Amount"
            type="number"
            fullWidth
            value={rechargeAmount}
            onChange={(e) => setRechargeAmount(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start">₹</InputAdornment>,
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedStudent(null)}>Cancel</Button>
          <Button onClick={handleRecharge} variant="contained">
            Recharge
          </Button>
        </DialogActions>
      </Dialog>

      {/* Daily Limit Dialog */}
      <Dialog 
        open={!!selectedStudent && activeTab === 1} 
        onClose={() => setSelectedStudent(null)}
      >
        <DialogTitle>
          Set Daily Limit for {selectedStudent?.student_name}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Daily Spending Limit"
            type="number"
            fullWidth
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start">₹</InputAdornment>,
            }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This is the maximum amount the student can spend per day at stores.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedStudent(null)}>Cancel</Button>
          <Button onClick={handleSetDailyLimit} variant="contained">
            Set Limit
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default RechargeManagement;
