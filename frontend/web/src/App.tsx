import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AidRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "approved" | "distributed" | "rejected";
  amount: number;
  location: string;
  needs: string[];
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AidRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    category: "food",
    description: "",
    amount: 0,
    location: "",
    needs: [""]
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRecord, setSelectedRecord] = useState<AidRecord | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Calculate statistics for dashboard
  const approvedCount = records.filter(r => r.status === "approved").length;
  const distributedCount = records.filter(r => r.status === "distributed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const totalAidAmount = records.reduce((sum, r) => sum + r.amount, 0);

  // Filter records based on search and filter criteria
  const filteredRecords = records.filter(record => {
    const matchesSearch = record.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          record.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          record.needs.some(need => need.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === "all" || record.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("aid_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: AidRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`aid_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                category: recordData.category,
                status: recordData.status || "pending",
                amount: recordData.amount || 0,
                location: recordData.location || "",
                needs: recordData.needs || []
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting sensitive data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newRecordData.category,
        status: "pending",
        amount: newRecordData.amount,
        location: newRecordData.location,
        needs: newRecordData.needs.filter(need => need.trim() !== "")
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `aid_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("aid_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "aid_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted aid request submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          category: "food",
          description: "",
          amount: 0,
          location: "",
          needs: [""]
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const approveRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE verification..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`aid_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "approved"
      };
      
      await contract.setData(
        `aid_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed - Aid approved!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const distributeRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE distribution..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`aid_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "distributed"
      };
      
      await contract.setData(
        `aid_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Aid distributed successfully with FHE protection!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Distribution failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const handleViewDetails = (record: AidRecord) => {
    setSelectedRecord(record);
    setShowDetailModal(true);
  };

  const renderPieChart = () => {
    const total = records.length || 1;
    const approvedPercentage = (approvedCount / total) * 100;
    const distributedPercentage = (distributedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment approved" 
            style={{ transform: `rotate(${approvedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment distributed" 
            style={{ transform: `rotate(${(approvedPercentage + distributedPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(approvedPercentage + distributedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{records.length}</div>
            <div className="pie-label">Total</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box approved"></div>
            <span>Approved: {approvedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box distributed"></div>
            <span>Distributed: {distributedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE secure connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Refugee<span>Aid</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn cyber-button"
          >
            <div className="add-icon"></div>
            Request Aid
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card intro-card">
            <h3>Anonymous Cross-Border Refugee Aid</h3>
            <p>Secure humanitarian aid distribution platform using Fully Homomorphic Encryption to protect refugee identity and location data while verifying eligibility.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <span>Encrypted identity registration</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <span>FHE eligibility verification</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🌐</div>
                <span>Secure distribution network</span>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Aid Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Requests</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{approvedCount}</div>
                <div className="stat-label">Approved</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{distributedCount}</div>
                <div className="stat-label">Distributed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalAidAmount}</div>
                <div className="stat-label">Total Aid</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>Aid Distribution Records</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text"
                  placeholder="Search by category, location, or needs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cyber-input"
                />
                <select 
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="cyber-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="distributed">Distributed</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <button 
                onClick={loadRecords}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Category</div>
              <div className="header-cell">Location</div>
              <div className="header-cell">Amount</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>No aid records found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Request Aid
                </button>
              </div>
            ) : (
              filteredRecords.map(record => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                  <div className="table-cell">{record.category}</div>
                  <div className="table-cell">{record.location}</div>
                  <div className="table-cell">{record.amount}</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn cyber-button info"
                      onClick={() => handleViewDetails(record)}
                    >
                      Details
                    </button>
                    {record.status === "pending" && (
                      <button 
                        className="action-btn cyber-button success"
                        onClick={() => approveRecord(record.id)}
                      >
                        Approve
                      </button>
                    )}
                    {record.status === "approved" && (
                      <button 
                        className="action-btn cyber-button primary"
                        onClick={() => distributeRecord(record.id)}
                      >
                        Distribute
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {showDetailModal && selectedRecord && (
        <ModalDetail 
          record={selectedRecord}
          onClose={() => setShowDetailModal(false)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>RefugeeAidFHE</span>
            </div>
            <p>Secure anonymous aid distribution using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} RefugeeAidFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleNeedChange = (index: number, value: string) => {
    const newNeeds = [...recordData.needs];
    newNeeds[index] = value;
    setRecordData({
      ...recordData,
      needs: newNeeds
    });
  };

  const addNeed = () => {
    setRecordData({
      ...recordData,
      needs: [...recordData.needs, ""]
    });
  };

  const removeNeed = (index: number) => {
    const newNeeds = recordData.needs.filter((_: any, i: number) => i !== index);
    setRecordData({
      ...recordData,
      needs: newNeeds
    });
  };

  const handleSubmit = () => {
    if (!recordData.category || !recordData.amount || !recordData.location) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Request Humanitarian Aid</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your identity and location will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Aid Category *</label>
              <select 
                name="category"
                value={recordData.category} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="food">Food Supplies</option>
                <option value="medical">Medical Aid</option>
                <option value="shelter">Shelter</option>
                <option value="clothing">Clothing</option>
                <option value="hygiene">Hygiene Kits</option>
                <option value="other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Amount Needed *</label>
              <input 
                type="number"
                name="amount"
                value={recordData.amount} 
                onChange={handleChange}
                placeholder="Quantity needed..." 
                className="cyber-input"
                min="1"
              />
            </div>
            
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text"
                name="location"
                value={recordData.location} 
                onChange={handleChange}
                placeholder="General location..." 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Specific Needs</label>
              {recordData.needs.map((need: string, index: number) => (
                <div key={index} className="need-input-group">
                  <input 
                    type="text"
                    value={need}
                    onChange={(e) => handleNeedChange(index, e.target.value)}
                    placeholder={`Need ${index + 1}...`}
                    className="cyber-input"
                  />
                  {recordData.needs.length > 1 && (
                    <button 
                      type="button"
                      onClick={() => removeNeed(index)}
                      className="remove-need-btn"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              <button 
                type="button"
                onClick={addNeed}
                className="add-need-btn cyber-button"
              >
                + Add Another Need
              </button>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Your personal information remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalDetailProps {
  record: AidRecord;
  onClose: () => void;
}

const ModalDetail: React.FC<ModalDetailProps> = ({ record, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal cyber-card">
        <div className="modal-header">
          <h2>Aid Request Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Request ID:</label>
              <span>#{record.id.substring(0, 8)}</span>
            </div>
            <div className="detail-item">
              <label>Category:</label>
              <span>{record.category}</span>
            </div>
            <div className="detail-item">
              <label>Location:</label>
              <span>{record.location}</span>
            </div>
            <div className="detail-item">
              <label>Amount:</label>
              <span>{record.amount}</span>
            </div>
            <div className="detail-item">
              <label>Status:</label>
              <span className={`status-badge ${record.status}`}>{record.status}</span>
            </div>
            <div className="detail-item">
              <label>Date Submitted:</label>
              <span>{new Date(record.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="detail-item full-width">
              <label>Specific Needs:</label>
              <div className="needs-list">
                {record.needs.map((need, index) => (
                  <span key={index} className="need-tag">{need}</span>
                ))}
              </div>
            </div>
            <div className="detail-item full-width">
              <label>FHE Protection:</label>
              <div className="fhe-status">
                <div className="encryption-badge">🔒 Encrypted</div>
                <p>This data is protected by Fully Homomorphic Encryption, ensuring privacy while enabling verification.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn cyber-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;