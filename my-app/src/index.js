import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import Text from './Text';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <h2>PBFT Visualization Project 2025</h2>
    <div></div>
    <Text />
    <div></div>
    <h4>View the PBFT Visualization</h4>
    <App />
    <h4>Timestamp: {sampleData.timestamp} </h4>
    
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
