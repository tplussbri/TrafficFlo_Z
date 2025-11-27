import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TrafficData {
  id: number;
  name: string;
  flowRate: string;
  signalTiming: string;
  congestionLevel: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface TrafficAnalysis {
  efficiencyScore: number;
  congestionIndex: number;
  optimizationPotential: number;
  safetyRating: number;
  environmentalImpact: number;
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
    status: "pending" as const, 
    message: "" 
  });
  const [newTrafficData, setNewTrafficData] = useState({ name: "", flowRate: "", signalTiming: "" });
  const [selectedData, setSelectedData] = useState<TrafficData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ flowRate: number | null; signalTiming: number | null }>({ flowRate: null, signalTiming: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
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
        await loadData();
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

  const loadData = async () => {
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
            id: parseInt(businessId.replace('traffic-', '')) || Date.now(),
            name: businessData.name,
            flowRate: businessId,
            signalTiming: businessId,
            congestionLevel: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
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
    setTransactionStatus({ visible: true, status: "pending", message: "Creating traffic data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const flowRateValue = parseInt(newTrafficData.flowRate) || 0;
      const businessId = `traffic-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, flowRateValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTrafficData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTrafficData.signalTiming) || 0,
        0,
        "Traffic Flow Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Traffic data created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTrafficData({ name: "", flowRate: "", signalTiming: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
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
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const analyzeTraffic = (data: TrafficData, decryptedFlow: number | null, decryptedSignal: number | null): TrafficAnalysis => {
    const flowRate = data.isVerified ? (data.decryptedValue || 0) : (decryptedFlow || data.publicValue1 || 5);
    const signalTiming = data.publicValue1 || 5;
    
    const baseEfficiency = Math.min(100, Math.round((flowRate * 0.6 + signalTiming * 0.4) * 8));
    const timeFactor = Math.max(0.7, Math.min(1.3, 1 - (Date.now()/1000 - data.timestamp) / (60 * 60 * 24 * 7)));
    const efficiencyScore = Math.round(baseEfficiency * timeFactor);
    
    const congestionIndex = Math.max(0, Math.min(100, 100 - (flowRate * 0.8 + signalTiming * 0.2)));
    const optimizationPotential = Math.min(95, Math.round((flowRate * 0.3 + signalTiming * 0.7) * 10));
    
    const safetyRating = Math.max(60, Math.min(100, 100 - (flowRate * 0.1 + congestionIndex * 0.3)));
    const environmentalImpact = Math.min(100, Math.round((flowRate * 0.4 + congestionIndex * 0.6) * 0.8));

    return {
      efficiencyScore,
      congestionIndex,
      optimizationPotential,
      safetyRating,
      environmentalImpact
    };
  };

  const filteredData = trafficData.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || item.isVerified;
    return matchesSearch && matchesFilter;
  });

  const renderDashboard = () => {
    const totalRecords = trafficData.length;
    const verifiedRecords = trafficData.filter(m => m.isVerified).length;
    const avgSignalTiming = trafficData.length > 0 
      ? trafficData.reduce((sum, m) => sum + m.publicValue1, 0) / trafficData.length 
      : 0;
    
    const recentRecords = trafficData.filter(m => 
      Date.now()/1000 - m.timestamp < 60 * 60 * 24 * 3
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel gradient-panel">
          <h3>Total Records</h3>
          <div className="stat-value">{totalRecords}</div>
          <div className="stat-trend">+{recentRecords} recent</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedRecords}/{totalRecords}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Avg Signal Timing</h3>
          <div className="stat-value">{avgSignalTiming.toFixed(1)}s</div>
          <div className="stat-trend">Optimized</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (data: TrafficData, decryptedFlow: number | null, decryptedSignal: number | null) => {
    const analysis = analyzeTraffic(data, decryptedFlow, decryptedSignal);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Efficiency Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.efficiencyScore}%` }}
            >
              <span className="bar-value">{analysis.efficiencyScore}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Congestion Index</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.congestionIndex}%` }}
            >
              <span className="bar-value">{analysis.congestionIndex}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Optimization Potential</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${analysis.optimizationPotential}%` }}
            >
              <span className="bar-value">{analysis.optimizationPotential}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🚗</div>
          <div className="step-content">
            <h4>Traffic Data Encryption</h4>
            <p>Flow rates encrypted with Zama FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🛣️</div>
          <div className="step-content">
            <h4>Public Storage</h4>
            <p>Encrypted data stored on-chain</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>Offline Decryption</h4>
            <p>Client performs offline decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">✅</div>
          <div className="step-content">
            <h4>On-chain Verification</h4>
            <p>FHE signature verification</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🚦 TrafficFlo Zama</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🚗</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted traffic flow system.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start managing encrypted traffic data</p>
              </div>
            </div>
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
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted traffic system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🚦 TrafficFlo Zama</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Traffic Data
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Traffic Flow Analytics (FHE 🔐)</h2>
          {renderDashboard()}
          
          <div className="panel gradient-panel full-width">
            <h3>FHE 🔐 Traffic Encryption Flow</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Traffic Data Records</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search records..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <label className="filter-checkbox">
                  <input 
                    type="checkbox" 
                    checked={filterVerified}
                    onChange={(e) => setFilterVerified(e.target.checked)}
                  />
                  Verified Only
                </label>
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            {filteredData.length === 0 ? (
              <div className="no-data">
                <p>No traffic data found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Record
                </button>
              </div>
            ) : filteredData.map((data, index) => (
              <div 
                className={`data-item ${selectedData?.id === data.id ? "selected" : ""} ${data.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedData(data)}
              >
                <div className="data-title">{data.name}</div>
                <div className="data-meta">
                  <span>Signal Timing: {data.publicValue1}s</span>
                  <span>Created: {new Date(data.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="data-status">
                  Status: {data.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                  {data.isVerified && data.decryptedValue && (
                    <span className="verified-amount">Flow: {data.decryptedValue} vehicles/h</span>
                  )}
                </div>
                <div className="data-creator">Creator: {data.creator.substring(0, 6)}...{data.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateData 
          onSubmit={createTrafficData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingData} 
          trafficData={newTrafficData} 
          setTrafficData={setNewTrafficData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedData && (
        <DataDetailModal 
          data={selectedData} 
          onClose={() => { 
            setSelectedData(null); 
            setDecryptedData({ flowRate: null, signalTiming: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedData.flowRate)}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateData: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  trafficData: any;
  setTrafficData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, trafficData, setTrafficData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'flowRate') {
      const intValue = value.replace(/[^\d]/g, '');
      setTrafficData({ ...trafficData, [name]: intValue });
    } else {
      setTrafficData({ ...trafficData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-data-modal">
        <div className="modal-header">
          <h2>New Traffic Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Traffic flow data will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Location Name *</label>
            <input 
              type="text" 
              name="name" 
              value={trafficData.name} 
              onChange={handleChange} 
              placeholder="Enter location name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Flow Rate (vehicles/h) *</label>
            <input 
              type="number" 
              name="flowRate" 
              value={trafficData.flowRate} 
              onChange={handleChange} 
              placeholder="Enter flow rate..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Signal Timing (seconds) *</label>
            <input 
              type="number" 
              min="1" 
              max="300" 
              name="signalTiming" 
              value={trafficData.signalTiming} 
              onChange={handleChange} 
              placeholder="Enter signal timing..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !trafficData.name || !trafficData.flowRate || !trafficData.signalTiming} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Data"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DataDetailModal: React.FC<{
  data: TrafficData;
  onClose: () => void;
  decryptedData: { flowRate: number | null; signalTiming: number | null };
  setDecryptedData: (value: { flowRate: number | null; signalTiming: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (data: TrafficData, decryptedFlow: number | null, decryptedSignal: number | null) => JSX.Element;
}> = ({ data, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.flowRate !== null) { 
      setDecryptedData({ flowRate: null, signalTiming: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ flowRate: decrypted, signalTiming: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="data-detail-modal">
        <div className="modal-header">
          <h2>Traffic Data Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="data-info">
            <div className="info-item">
              <span>Location:</span>
              <strong>{data.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{data.creator.substring(0, 6)}...{data.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Signal Timing:</span>
              <strong>{data.publicValue1}s</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Flow Data</h3>
            
            <div className="data-row">
              <div className="data-label">Flow Rate:</div>
              <div className="data-value">
                {data.isVerified && data.decryptedValue ? 
                  `${data.decryptedValue} vehicles/h (Verified)` : 
                  decryptedData.flowRate !== null ? 
                  `${decryptedData.flowRate} vehicles/h (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(data.isVerified || decryptedData.flowRate !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : data.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.flowRate !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Traffic Encryption</strong>
                <p>Flow data is encrypted on-chain. Click to verify decryption using FHE signatures.</p>
              </div>
            </div>
          </div>
          
          {(data.isVerified || decryptedData.flowRate !== null) && (
            <div className="analysis-section">
              <h3>Traffic Analysis</h3>
              {renderAnalysisChart(
                data, 
                data.isVerified ? data.decryptedValue || null : decryptedData.flowRate, 
                null
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Flow Rate:</span>
                  <strong>
                    {data.isVerified ? 
                      `${data.decryptedValue} vehicles/h` : 
                      `${decryptedData.flowRate} vehicles/h`
                    }
                  </strong>
                  <span className={`data-badge ${data.isVerified ? 'verified' : 'local'}`}>
                    {data.isVerified ? 'Verified' : 'Local'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Signal Timing:</span>
                  <strong>{data.publicValue1}s</strong>
                  <span className="data-badge public">Public</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!data.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;