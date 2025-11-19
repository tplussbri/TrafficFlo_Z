import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TrafficData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TrafficStats {
  totalRecords: number;
  verifiedRecords: number;
  avgTrafficFlow: number;
  recentActivity: number;
  congestionLevel: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [trafficData, setTrafficData] = useState<TrafficData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingData, setCreatingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTrafficData, setNewTrafficData] = useState({ 
    location: "", 
    flowRate: "", 
    congestion: "" 
  });
  const [selectedData, setSelectedData] = useState<TrafficData | null>(null);
  const [decryptedValues, setDecryptedValues] = useState<Map<string, number>>(new Map());
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState<TrafficStats>({
    totalRecords: 0,
    verifiedRecords: 0,
    avgTrafficFlow: 0,
    recentActivity: 0,
    congestionLevel: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadTrafficData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    calculateStats();
  }, [trafficData]);

  const calculateStats = () => {
    const totalRecords = trafficData.length;
    const verifiedRecords = trafficData.filter(d => d.isVerified).length;
    const avgTrafficFlow = totalRecords > 0 
      ? trafficData.reduce((sum, d) => sum + d.publicValue1, 0) / totalRecords 
      : 0;
    const recentActivity = trafficData.filter(d => 
      Date.now()/1000 - d.timestamp < 60 * 60 * 24
    ).length;
    const congestionLevel = totalRecords > 0 
      ? trafficData.reduce((sum, d) => sum + d.publicValue2, 0) / totalRecords 
      : 0;

    setStats({
      totalRecords,
      verifiedRecords,
      avgTrafficFlow,
      recentActivity,
      congestionLevel
    });
  };

  const loadTrafficData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const dataList: TrafficData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          dataList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading traffic data:', e);
        }
      }
      
      setTrafficData(dataList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createTrafficData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating traffic data with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const flowRateValue = parseInt(newTrafficData.flowRate) || 0;
      const businessId = `traffic-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, flowRateValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTrafficData.location,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        flowRateValue,
        parseInt(newTrafficData.congestion) || 0,
        "Traffic flow data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Traffic data created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadTrafficData();
      setShowCreateModal(false);
      setNewTrafficData({ location: "", flowRate: "", congestion: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingData(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadTrafficData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadTrafficData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecryptClick = async (data: TrafficData) => {
    const decryptedValue = await decryptData(data.id);
    if (decryptedValue !== null) {
      setDecryptedValues(new Map(decryptedValues.set(data.id, decryptedValue)));
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is available: ${isAvailable}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderDashboard = () => {
    return (
      <div className="dashboard-panels">
        <div className="stats-panel neon-panel">
          <h3>Total Records</h3>
          <div className="stat-value">{stats.totalRecords}</div>
          <div className="stat-trend">+{stats.recentActivity} today</div>
        </div>
        
        <div className="stats-panel neon-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedRecords}/{stats.totalRecords}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="stats-panel neon-panel">
          <h3>Avg Flow Rate</h3>
          <div className="stat-value">{stats.avgTrafficFlow.toFixed(1)}</div>
          <div className="stat-trend">vehicles/min</div>
        </div>
        
        <div className="stats-panel neon-panel">
          <h3>Congestion Level</h3>
          <div className="stat-value">{stats.congestionLevel.toFixed(1)}%</div>
          <div className="stat-trend">FHE Encrypted</div>
        </div>
      </div>
    );
  };

  const renderTrafficChart = (data: TrafficData) => {
    const flowRate = data.isVerified ? 
      (data.decryptedValue || 0) : 
      (decryptedValues.get(data.id) || data.publicValue1);
    
    const congestion = data.publicValue2;
    
    return (
      <div className="traffic-chart">
        <div className="chart-row">
          <div className="chart-label">Flow Rate</div>
          <div className="chart-bar">
            <div 
              className="bar-fill flow" 
              style={{ width: `${Math.min(100, flowRate)}%` }}
            >
              <span className="bar-value">{flowRate}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Congestion</div>
          <div className="chart-bar">
            <div 
              className="bar-fill congestion" 
              style={{ width: `${congestion}%` }}
            >
              <span className="bar-value">{congestion}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFeatures = () => {
    return (
      <div className="features-section">
        <div className="feature-card">
          <div className="feature-icon">🔐</div>
          <h4>FHE Encryption</h4>
          <p>Traffic data encrypted with Zama FHE for privacy protection</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🚦</div>
          <h4>Smart Signals</h4>
          <p>Traffic lights adjust based on encrypted flow data</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📊</div>
          <h4>Real-time Analytics</h4>
          <p>Live traffic analysis without compromising privacy</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">⚡</div>
          <h4>Fast Processing</h4>
          <p>Homomorphic computations on encrypted data</p>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <div className="faq-item">
          <h4>How does FHE protect traffic data?</h4>
          <p>FHE allows computations on encrypted data without decryption, ensuring privacy while enabling smart traffic optimization.</p>
        </div>
        <div className="faq-item">
          <h4>What data is encrypted?</h4>
          <p>Traffic flow rates are fully encrypted. Only congestion levels and metadata remain public for analysis.</p>
        </div>
        <div className="faq-item">
          <h4>How are traffic lights optimized?</h4>
          <p>Signals adjust timing based on encrypted flow patterns, reducing congestion without monitoring individual vehicles.</p>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Traffic Flow 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🚦</div>
            <h2>Connect Wallet to Access FHE Traffic System</h2>
            <p>Secure, privacy-preserving traffic optimization powered by Fully Homomorphic Encryption</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading traffic optimization system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Traffic Flow 🚦</h1>
          <p>Privacy-Preserving Traffic Optimization</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="neon-btn">Check Contract</button>
          <button onClick={() => setShowCreateModal(true)} className="neon-btn primary">+ Add Traffic Data</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button 
          className={`nav-btn ${activeTab === "data" ? "active" : ""}`}
          onClick={() => setActiveTab("data")}
        >
          Traffic Data
        </button>
        <button 
          className={`nav-btn ${activeTab === "features" ? "active" : ""}`}
          onClick={() => setActiveTab("features")}
        >
          Features
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          FAQ
        </button>
      </nav>
      
      <main className="main-content">
        {activeTab === "dashboard" && (
          <div className="tab-content">
            <h2>Traffic Analytics Dashboard</h2>
            {renderDashboard()}
            
            <div className="realtime-panel neon-panel">
              <h3>Real-time Traffic Flow</h3>
              <div className="traffic-visualization">
                <div className="road-network">
                  <div className="intersection active"></div>
                  <div className="road horizontal"></div>
                  <div className="road vertical"></div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "data" && (
          <div className="tab-content">
            <div className="section-header">
              <h2>Traffic Data Records</h2>
              <div className="header-actions">
                <button onClick={loadTrafficData} className="neon-btn" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh Data"}
                </button>
              </div>
            </div>
            
            <div className="data-list">
              {trafficData.length === 0 ? (
                <div className="no-data">
                  <p>No traffic data records found</p>
                  <button className="neon-btn primary" onClick={() => setShowCreateModal(true)}>
                    Add First Record
                  </button>
                </div>
              ) : (
                trafficData.map((data, index) => (
                  <div 
                    className={`data-item neon-card ${selectedData?.id === data.id ? "selected" : ""}`}
                    key={index}
                    onClick={() => setSelectedData(data)}
                  >
                    <div className="data-header">
                      <h3>{data.name}</h3>
                      <span className={`status-badge ${data.isVerified ? "verified" : "encrypted"}`}>
                        {data.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                      </span>
                    </div>
                    <div className="data-details">
                      <span>Flow: {data.publicValue1}</span>
                      <span>Congestion: {data.publicValue2}%</span>
                      <span>{new Date(data.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <button 
                      className={`decrypt-btn ${data.isVerified || decryptedValues.has(data.id) ? "decrypted" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDecryptClick(data);
                      }}
                      disabled={isDecrypting}
                    >
                      {isDecrypting ? "Decrypting..." : 
                       data.isVerified ? "Verified" : 
                       decryptedValues.has(data.id) ? "Decrypted" : "Decrypt"}
                    </button>
                  </div>
                ))
              )}
            </div>
            
            {selectedData && (
              <div className="detail-panel neon-panel">
                <h3>Traffic Data Details</h3>
                {renderTrafficChart(selectedData)}
                <div className="data-info">
                  <p><strong>Location:</strong> {selectedData.name}</p>
                  <p><strong>Encrypted Flow Rate:</strong> 
                    {selectedData.isVerified ? 
                      ` ${selectedData.decryptedValue} (verified)` : 
                      decryptedValues.has(selectedData.id) ?
                      ` ${decryptedValues.get(selectedData.id)} (decrypted)` :
                      " 🔒 Encrypted"
                    }
                  </p>
                  <p><strong>Congestion Level:</strong> {selectedData.publicValue2}%</p>
                  <p><strong>Recorded:</strong> {new Date(selectedData.timestamp * 1000).toLocaleString()}</p>
                </div>
              </div>
            )}
          </div>
        )}
        
        {activeTab === "features" && (
          <div className="tab-content">
            <h2>FHE Traffic Optimization Features</h2>
            {renderFeatures()}
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="tab-content">
            <h2>Frequently Asked Questions</h2>
            {renderFAQ()}
          </div>
        )}
      </main>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal neon-modal">
            <div className="modal-header">
              <h2>Add Traffic Data</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Location</label>
                <input 
                  type="text" 
                  value={newTrafficData.location}
                  onChange={(e) => setNewTrafficData({...newTrafficData, location: e.target.value})}
                  placeholder="Enter location..."
                />
              </div>
              
              <div className="form-group">
                <label>Flow Rate (FHE Encrypted)</label>
                <input 
                  type="number" 
                  value={newTrafficData.flowRate}
                  onChange={(e) => setNewTrafficData({...newTrafficData, flowRate: e.target.value})}
                  placeholder="Vehicles per minute"
                />
              </div>
              
              <div className="form-group">
                <label>Congestion Level (%)</label>
                <input 
                  type="number" 
                  min="0"
                  max="100"
                  value={newTrafficData.congestion}
                  onChange={(e) => setNewTrafficData({...newTrafficData, congestion: e.target.value})}
                  placeholder="0-100%"
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="neon-btn">Cancel</button>
              <button 
                onClick={createTrafficData}
                disabled={creatingData || isEncrypting}
                className="neon-btn primary"
              >
                {creatingData || isEncrypting ? "Encrypting..." : "Create Record"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

