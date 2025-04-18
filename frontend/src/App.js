import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useState, useEffect } from 'react';
import axios from 'axios';

// Components
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import StudentRegistration from './components/StudentRegistration';
import StoreRegistration from './components/StoreRegistration';
import RechargeManagement from './components/RechargeManagement';
import SettlementManagement from './components/SettlementManagement';
import Analytics from './components/Analytics';

const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
    background: {
      default: '#f5f5f5',
    },
  },
});

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const verifyToken = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          await axios.get('http://localhost:5000/api/verify-token', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          setIsAuthenticated(true);
        } catch (error) {
          localStorage.removeItem('token');
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }
      setIsLoading(false);
    };

    verifyToken();
  }, []);

  const PrivateRoute = ({ children }) => {
    if (isLoading) {
      return (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh',
          fontSize: '1.2rem',
          color: '#666'
        }}>
          Loading...
        </div>
      );
    }
    return isAuthenticated ? children : <Navigate to="/login" />;
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route 
            path="/login" 
            element={
              isAuthenticated ? 
                <Navigate to="/" /> : 
                <Login setIsAuthenticated={setIsAuthenticated} />
            } 
          />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Dashboard setIsAuthenticated={setIsAuthenticated} />
              </PrivateRoute>
            }
          />
          <Route
            path="/student-registration"
            element={
              <PrivateRoute>
                <StudentRegistration />
              </PrivateRoute>
            }
          />
          <Route
            path="/store-registration"
            element={
              <PrivateRoute>
                <StoreRegistration />
              </PrivateRoute>
            }
          />
          <Route
            path="/recharge"
            element={
              <PrivateRoute>
                <RechargeManagement />
              </PrivateRoute>
            }
          />
          <Route
            path="/settlements"
            element={
              <PrivateRoute>
                <SettlementManagement />
              </PrivateRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <PrivateRoute>
                <Analytics />
              </PrivateRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
