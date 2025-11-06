pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TrafficFlowController is ZamaEthereumConfig {
    struct TrafficNode {
        string nodeId;
        euint32 encryptedFlowRate;
        uint256 publicThreshold;
        uint256 lastUpdated;
        uint32 decryptedFlowRate;
        bool isVerified;
    }

    struct SignalControl {
        string signalId;
        euint32 encryptedCycleTime;
        uint256 publicMinCycle;
        uint256 publicMaxCycle;
        uint32 decryptedCycleTime;
        bool isVerified;
    }

    mapping(string => TrafficNode) public trafficNodes;
    mapping(string => SignalControl) public signalControls;
    
    string[] public nodeIds;
    string[] public signalIds;

    event TrafficNodeRegistered(string indexed nodeId, address indexed creator);
    event SignalControlRegistered(string indexed signalId, address indexed creator);
    event FlowRateDecrypted(string indexed nodeId, uint32 decryptedValue);
    event CycleTimeDecrypted(string indexed signalId, uint32 decryptedValue);
    event TrafficAdjusted(string indexed nodeId, string indexed signalId);

    constructor() ZamaEthereumConfig() {
    }

    function registerTrafficNode(
        string calldata nodeId,
        externalEuint32 encryptedFlowRate,
        bytes calldata inputProof,
        uint256 publicThreshold
    ) external {
        require(bytes(trafficNodes[nodeId].nodeId).length == 0, "Node already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedFlowRate, inputProof)), "Invalid encrypted flow rate");

        trafficNodes[nodeId] = TrafficNode({
            nodeId: nodeId,
            encryptedFlowRate: FHE.fromExternal(encryptedFlowRate, inputProof),
            publicThreshold: publicThreshold,
            lastUpdated: block.timestamp,
            decryptedFlowRate: 0,
            isVerified: false
        });

        FHE.allowThis(trafficNodes[nodeId].encryptedFlowRate);
        FHE.makePubliclyDecryptable(trafficNodes[nodeId].encryptedFlowRate);
        nodeIds.push(nodeId);
        emit TrafficNodeRegistered(nodeId, msg.sender);
    }

    function registerSignalControl(
        string calldata signalId,
        externalEuint32 encryptedCycleTime,
        bytes calldata inputProof,
        uint256 publicMinCycle,
        uint256 publicMaxCycle
    ) external {
        require(bytes(signalControls[signalId].signalId).length == 0, "Signal already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedCycleTime, inputProof)), "Invalid encrypted cycle time");

        signalControls[signalId] = SignalControl({
            signalId: signalId,
            encryptedCycleTime: FHE.fromExternal(encryptedCycleTime, inputProof),
            publicMinCycle: publicMinCycle,
            publicMaxCycle: publicMaxCycle,
            decryptedCycleTime: 0,
            isVerified: false
        });

        FHE.allowThis(signalControls[signalId].encryptedCycleTime);
        FHE.makePubliclyDecryptable(signalControls[signalId].encryptedCycleTime);
        signalIds.push(signalId);
        emit SignalControlRegistered(signalId, msg.sender);
    }

    function verifyFlowRate(
        string calldata nodeId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(trafficNodes[nodeId].nodeId).length > 0, "Node does not exist");
        require(!trafficNodes[nodeId].isVerified, "Flow rate already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(trafficNodes[nodeId].encryptedFlowRate);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        trafficNodes[nodeId].decryptedFlowRate = decodedValue;
        trafficNodes[nodeId].isVerified = true;
        trafficNodes[nodeId].lastUpdated = block.timestamp;
        emit FlowRateDecrypted(nodeId, decodedValue);
    }

    function verifyCycleTime(
        string calldata signalId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(signalControls[signalId].signalId).length > 0, "Signal does not exist");
        require(!signalControls[signalId].isVerified, "Cycle time already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(signalControls[signalId].encryptedCycleTime);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        signalControls[signalId].decryptedCycleTime = decodedValue;
        signalControls[signalId].isVerified = true;
        emit CycleTimeDecrypted(signalId, decodedValue);
    }

    function adjustSignalBasedOnFlow(
        string calldata nodeId,
        string calldata signalId
    ) external {
        require(bytes(trafficNodes[nodeId].nodeId).length > 0, "Node does not exist");
        require(bytes(signalControls[signalId].signalId).length > 0, "Signal does not exist");
        require(trafficNodes[nodeId].isVerified, "Flow rate not verified");
        require(signalControls[signalId].isVerified, "Cycle time not verified");

        uint32 flowRate = trafficNodes[nodeId].decryptedFlowRate;
        uint32 currentCycle = signalControls[signalId].decryptedCycleTime;
        uint256 threshold = trafficNodes[nodeId].publicThreshold;
        uint256 minCycle = signalControls[signalId].publicMinCycle;
        uint256 maxCycle = signalControls[signalId].publicMaxCycle;

        uint32 newCycle = currentCycle;
        if (flowRate > threshold) {
            uint32 increment = uint32((flowRate - threshold) / 10);
            newCycle = currentCycle + increment;
            if (newCycle > maxCycle) newCycle = maxCycle;
        } else {
            uint32 decrement = uint32((threshold - flowRate) / 15);
            if (decrement > currentCycle) decrement = currentCycle;
            newCycle = currentCycle - decrement;
            if (newCycle < minCycle) newCycle = minCycle;
        }

        signalControls[signalId].decryptedCycleTime = newCycle;
        trafficNodes[nodeId].lastUpdated = block.timestamp;
        emit TrafficAdjusted(nodeId, signalId);
    }

    function getTrafficNode(string calldata nodeId) external view returns (
        string memory nodeIdOut,
        uint256 publicThreshold,
        uint256 lastUpdated,
        bool isVerified,
        uint32 decryptedFlowRate
    ) {
        require(bytes(trafficNodes[nodeId].nodeId).length > 0, "Node does not exist");
        TrafficNode storage node = trafficNodes[nodeId];
        return (
            node.nodeId,
            node.publicThreshold,
            node.lastUpdated,
            node.isVerified,
            node.decryptedFlowRate
        );
    }

    function getSignalControl(string calldata signalId) external view returns (
        string memory signalIdOut,
        uint256 publicMinCycle,
        uint256 publicMaxCycle,
        bool isVerified,
        uint32 decryptedCycleTime
    ) {
        require(bytes(signalControls[signalId].signalId).length > 0, "Signal does not exist");
        SignalControl storage signal = signalControls[signalId];
        return (
            signal.signalId,
            signal.publicMinCycle,
            signal.publicMaxCycle,
            signal.isVerified,
            signal.decryptedCycleTime
        );
    }

    function getAllNodeIds() external view returns (string[] memory) {
        return nodeIds;
    }

    function getAllSignalIds() external view returns (string[] memory) {
        return signalIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

