// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract RefugeeAssistanceFHE is SepoliaConfig {
    struct EncryptedRefugee {
        uint256 refugeeId;
        euint32 encryptedIdentity;    // Encrypted identity data
        euint32 encryptedLocation;   // Encrypted location coordinates
        euint32 encryptedNeeds;      // Encrypted assistance needs
        uint256 timestamp;
    }

    struct EncryptedAidPackage {
        uint256 packageId;
        euint32 encryptedResources;  // Encrypted resource types
        euint32 encryptedQuantities; // Encrypted quantities
        uint256 timestamp;
    }

    struct EncryptedVerification {
        uint256 verificationId;
        euint32 encryptedEligibility; // Encrypted eligibility score
        euint32 encryptedPriority;    // Encrypted priority level
        uint256 refugeeId;
        uint256 packageId;
        uint256 verifiedAt;
    }

    struct DecryptedResult {
        uint32 eligibility;
        uint32 priority;
        bool isRevealed;
    }

    uint256 public refugeeCount;
    uint256 public packageCount;
    uint256 public verificationCount;
    mapping(uint256 => EncryptedRefugee) public encryptedRefugees;
    mapping(uint256 => EncryptedAidPackage) public encryptedPackages;
    mapping(uint256 => EncryptedVerification) public encryptedVerifications;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    
    mapping(uint256 => uint256) private requestToRefugeeId;
    mapping(uint256 => uint256) private verificationRequestToId;
    
    event RefugeeRegistered(uint256 indexed refugeeId, uint256 timestamp);
    event AidPackageCreated(uint256 indexed packageId, uint256 timestamp);
    event VerificationRequested(uint256 indexed requestId, uint256 refugeeId);
    event VerificationCompleted(uint256 indexed verificationId);
    event ResultDecrypted(uint256 indexed verificationId);

    modifier onlyAgency() {
        // Add proper aid agency authentication in production
        _;
    }

    function registerEncryptedRefugee(
        euint32 encryptedIdentity,
        euint32 encryptedLocation,
        euint32 encryptedNeeds
    ) public onlyAgency {
        refugeeCount += 1;
        uint256 newRefugeeId = refugeeCount;
        
        encryptedRefugees[newRefugeeId] = EncryptedRefugee({
            refugeeId: newRefugeeId,
            encryptedIdentity: encryptedIdentity,
            encryptedLocation: encryptedLocation,
            encryptedNeeds: encryptedNeeds,
            timestamp: block.timestamp
        });
        
        emit RefugeeRegistered(newRefugeeId, block.timestamp);
    }

    function createAidPackage(
        euint32 encryptedResources,
        euint32 encryptedQuantities
    ) public onlyAgency {
        packageCount += 1;
        uint256 newPackageId = packageCount;
        
        encryptedPackages[newPackageId] = EncryptedAidPackage({
            packageId: newPackageId,
            encryptedResources: encryptedResources,
            encryptedQuantities: encryptedQuantities,
            timestamp: block.timestamp
        });
        
        emit AidPackageCreated(newPackageId, block.timestamp);
    }

    function verifyEligibility(uint256 refugeeId, uint256 packageId) public onlyAgency {
        EncryptedRefugee storage refugee = encryptedRefugees[refugeeId];
        EncryptedAidPackage storage aidPackage = encryptedPackages[packageId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(refugee.encryptedIdentity);
        ciphertexts[1] = FHE.toBytes32(refugee.encryptedNeeds);
        ciphertexts[2] = FHE.toBytes32(aidPackage.encryptedResources);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.performVerification.selector);
        requestToRefugeeId[reqId] = refugeeId;
        
        emit VerificationRequested(reqId, refugeeId);
    }

    function performVerification(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 refugeeId = requestToRefugeeId[requestId];
        require(refugeeId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory identity, string memory needs, string memory resources) = 
            abi.decode(cleartexts, (string, string, string));
        
        // Simulate FHE eligibility verification (in production this would be done off-chain)
        verificationCount += 1;
        uint256 newVerificationId = verificationCount;
        
        // Simplified verification logic
        uint32 eligibility = calculateEligibility(identity, needs);
        uint32 priority = calculatePriority(needs, resources);
        
        encryptedVerifications[newVerificationId] = EncryptedVerification({
            verificationId: newVerificationId,
            encryptedEligibility: FHE.asEuint32(eligibility),
            encryptedPriority: FHE.asEuint32(priority),
            refugeeId: refugeeId,
            packageId: 0, // Placeholder for demo
            verifiedAt: block.timestamp
        });
        
        decryptedResults[newVerificationId] = DecryptedResult({
            eligibility: eligibility,
            priority: priority,
            isRevealed: false
        });
        
        emit VerificationCompleted(newVerificationId);
    }

    function requestVerificationResult(uint256 verificationId) public onlyAgency {
        EncryptedVerification storage verification = encryptedVerifications[verificationId];
        require(!decryptedResults[verificationId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(verification.encryptedEligibility);
        ciphertexts[1] = FHE.toBytes32(verification.encryptedPriority);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptVerification.selector);
        verificationRequestToId[reqId] = verificationId;
    }

    function decryptVerification(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 verificationId = verificationRequestToId[requestId];
        require(verificationId != 0, "Invalid request");
        
        DecryptedResult storage dResult = decryptedResults[verificationId];
        require(!dResult.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 eligibility, uint32 priority) = abi.decode(cleartexts, (uint32, uint32));
        
        dResult.eligibility = eligibility;
        dResult.priority = priority;
        dResult.isRevealed = true;
        
        emit ResultDecrypted(verificationId);
    }

    function getDecryptedResult(uint256 verificationId) public view returns (
        uint32 eligibility,
        uint32 priority,
        bool isRevealed
    ) {
        DecryptedResult storage r = decryptedResults[verificationId];
        return (r.eligibility, r.priority, r.isRevealed);
    }

    function getEncryptedRefugee(uint256 refugeeId) public view returns (
        euint32 identity,
        euint32 location,
        euint32 needs,
        uint256 timestamp
    ) {
        EncryptedRefugee storage r = encryptedRefugees[refugeeId];
        return (r.encryptedIdentity, r.encryptedLocation, r.encryptedNeeds, r.timestamp);
    }

    function getEncryptedAidPackage(uint256 packageId) public view returns (
        euint32 resources,
        euint32 quantities,
        uint256 timestamp
    ) {
        EncryptedAidPackage storage p = encryptedPackages[packageId];
        return (p.encryptedResources, p.encryptedQuantities, p.timestamp);
    }

    function getEncryptedVerification(uint256 verificationId) public view returns (
        euint32 eligibility,
        euint32 priority,
        uint256 refugeeId,
        uint256 packageId,
        uint256 verifiedAt
    ) {
        EncryptedVerification storage v = encryptedVerifications[verificationId];
        return (v.encryptedEligibility, v.encryptedPriority, v.refugeeId, v.packageId, v.verifiedAt);
    }

    // Helper functions for demo purposes
    function calculateEligibility(string memory identity, string memory needs) private pure returns (uint32) {
        // Simplified eligibility calculation
        bytes memory idBytes = bytes(identity);
        bytes memory needsBytes = bytes(needs);
        uint32 score = 0;
        
        if (idBytes.length > 10) score += 50;
        if (needsBytes.length > 5) score += 50;
        
        return score > 100 ? 100 : score;
    }

    function calculatePriority(string memory needs, string memory resources) private pure returns (uint32) {
        // Simplified priority calculation
        bytes memory needsBytes = bytes(needs);
        bytes memory resBytes = bytes(resources);
        uint32 matches = 0;
        
        for (uint i = 0; i < needsBytes.length && i < resBytes.length; i++) {
            if (needsBytes[i] == resBytes[i]) {
                matches++;
            }
        }
        
        return matches * 100 / uint32(needsBytes.length > 0 ? needsBytes.length : 1);
    }
}