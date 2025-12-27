import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle, Clock, Users, BarChart3, Vote as VoteIcon,
  Wallet, Trophy, ArrowLeft, Calendar
} from 'lucide-react';
import { ethers } from 'ethers';
import { FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI } from '@/lib/contract';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from './LanguageSelector';
import { VoiceControls } from './VoiceControls';
import EmailService, { sendElectionResults } from './EmailService';

const ElectionVoting = ({ electionId, onBack }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [election, setElection] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [userAddress, setUserAddress] = useState('');
  const [voterName, setVoterName] = useState('');
  const [voterEmail, setVoterEmail] = useState('');
  const [isVoting, setIsVoting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const [winner, setWinner] = useState(null);
  const [emailCollected, setEmailCollected] = useState(false);
  const [govtIdAuthenticated, setGovtIdAuthenticated] = useState(false);
  const [govtId, setGovtId] = useState('');
  const [govtIdType, setGovtIdType] = useState('voter');

  useEffect(() => {
    fetchElectionData();
    checkWalletConnection();
  }, [electionId]);

  useEffect(() => {
    if (election && election.active) {
      const timer = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const remaining = Math.max(0, election.endTime - now);
        setTimeLeft(remaining);
        
        if (remaining === 0) {
          fetchElectionData(); // Refresh to get updated status
        }
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [election]);

  const checkWalletConnection = async () => {
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          setUserAddress(accounts[0]);
          setIsConnected(true);
        }
      }
    } catch (error) {
      console.error('Error checking wallet connection:', error);
    }
  };

  const fetchElectionData = async () => {
    try {
      setLoading(true);
      
      // Check cache first
      const cacheKey = `election-${electionId}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < 15000) { // 15 second cache
            setElection(data.election);
            setCandidates(data.candidates);
            setWinner(data.winner);
            setLoading(false);
            // Still fetch fresh data in background
            setTimeout(() => fetchFreshElectionData(), 100);
            return;
          }
        }
      } catch (cacheError) {
        console.log('Cache error:', cacheError);
      }

      await fetchFreshElectionData();
    } catch (error) {
      console.error('Error fetching election data:', error);
      setLoading(false);
    }
  };

  const fetchFreshElectionData = async () => {
    try {
      if (!window.ethereum) {
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI, provider);

      // Fetch all data in parallel
      const [electionResult, candidateResults, winnerResult] = await Promise.allSettled([
        contract.getElection(electionId),
        Promise.all(
          Array.from({ length: 10 }, (_, i) => 
            contract.getCandidate(electionId, i).catch(() => null)
          )
        ),
        contract.getWinner(electionId).catch(() => null)
      ]);

      // Process election data
      if (electionResult.status === 'fulfilled') {
        const [title, description, startTime, endTime, active, candidatesCount, totalVotes] = electionResult.value;
        
        const electionData = {
          id: electionId,
          title,
          description,
          startTime: Number(startTime),
          endTime: Number(endTime),
          active,
          candidatesCount: Number(candidatesCount),
          totalVotes: Number(totalVotes)
        };
        
        setElection(electionData);

        // Process candidates
        const candidatesList = [];
        if (candidateResults.status === 'fulfilled') {
          candidateResults.value
            .filter(result => result !== null)
            .forEach((result, i) => {
              try {
                const [candidateId, candidateName, candidateVotes] = result;
                const fullName = candidateName.toString().trim();
                if (fullName) {
                  candidatesList.push({
                    id: Number(candidateId),
                    name: fullName,
                    votes: Number(candidateVotes)
                  });
                }
              } catch (err) {
                console.log(`Error processing candidate ${i}`);
              }
            });
        }
        setCandidates(candidatesList);

        // Process winner
        let winnerData = null;
        if (winnerResult.status === 'fulfilled' && winnerResult.value) {
          const [winnerName, winnerVotes] = winnerResult.value;
          winnerData = { name: winnerName, votes: Number(winnerVotes) };
          setWinner(winnerData);
        }

        // Cache the results
        const cacheKey = `election-${electionId}`;
        localStorage.setItem(cacheKey, JSON.stringify({
          data: {
            election: electionData,
            candidates: candidatesList,
            winner: winnerData
          },
          timestamp: Date.now()
        }));

        // Calculate time left
        const now = Math.floor(Date.now() / 1000);
        const remaining = Math.max(0, Number(electionData.endTime) - now);
        setTimeLeft(remaining);
      }
    } catch (error) {
      console.error('Error fetching fresh election data:', error);
    } finally {
      setLoading(false);
    }
  };

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        throw new Error('MetaMask wallet not found. Please install MetaMask extension.');
      }

      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // Check and switch to Fuji network
      try {
        const network = await provider.getNetwork();
        if (network.chainId !== 43113n) { // Fuji testnet
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xa869' }], // 43113 in hex
          });
        }
      } catch (networkError) {
        if (networkError.code === 4902) {
          // Add Fuji network if not exists
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xa869',
              chainName: 'Avalanche Fuji Testnet',
              nativeCurrency: {
                name: 'AVAX',
                symbol: 'AVAX',
                decimals: 18,
              },
              rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
              blockExplorerUrls: ['https://testnet.snowtrace.io/'],
            }],
          });
        } else {
          throw networkError;
        }
      }
      
      setUserAddress(accounts[0]);
      setIsConnected(true);

      toast({
        title: t('common.success'),
        description: t('voting.walletConnected'),
        variant: 'default'
      });
    } catch (error) {
      let errorMessage = error.message;
      
      if (error.code === 4001) {
        errorMessage = 'User rejected the connection request.';
      } else if (error.code === -32002) {
        errorMessage = 'Connection request already pending. Please check MetaMask.';
      }
      
      toast({
        title: t('common.error'),
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  const vote = async (candidateId) => {
    if (!voterName.trim() || !emailCollected) {
      toast({
        title: t('common.error'),
        description: t('voting.enterDetails'),
        variant: 'destructive'
      });
      return;
    }

    try {
      setIsVoting(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI, signer);

      const tx = await contract.vote(electionId, candidateId);

      toast({
        title: t('voting.voting'),
        description: 'Processing your vote...',
        variant: 'default'
      });

      await tx.wait();

      // Coercion-resistant: Show neutral success message without revealing candidate
      setHasVoted(true);
      toast({
        title: 'Vote Successfully Recorded',
        description: 'Your vote has been securely recorded on the blockchain.',
        variant: 'default'
      });

      // Refresh data
      fetchElectionData();
    } catch (error) {
      console.error('Voting error:', error);
      // Coercion-resistant: Allow re-voting, don't block on "Already voted"
      // The smart contract should handle this by overwriting the previous vote
      toast({
        title: t('common.error'),
        description: error.message || t('voting.voteError'),
        variant: 'destructive'
      });
    } finally {
      setIsVoting(false);
    }
  };

  const handleEmailCollected = (email, name) => {
    setVoterEmail(email);
    setVoterName(name);
    setEmailCollected(true);
  };

  const handleGovtIdLogin = () => {
    if (!govtId.trim()) {
      toast({
        title: t('common.error'),
        description: 'Please enter your Government ID',
        variant: 'destructive'
      });
      return;
    }

    // For demo purposes - accept any input as valid
    setGovtIdAuthenticated(true);
    toast({
      title: t('common.success'),
      description: `Authenticated with ${govtIdType.toUpperCase()}: ${govtId}`,
      variant: 'default'
    });
  };

  const formatTimeLeft = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background/50 to-primary/5">
        <div className="container mx-auto px-4 py-8">
          {/* Header skeleton */}
          <div className="flex justify-between items-start mb-8">
            <div className="h-8 bg-muted rounded w-32 animate-pulse"></div>
            <div className="flex gap-4">
              <div className="h-8 bg-muted rounded w-24 animate-pulse"></div>
              <div className="h-8 bg-muted rounded w-24 animate-pulse"></div>
            </div>
          </div>

          {/* Election info skeleton */}
          <Card className="p-8 mb-8">
            <div className="text-center mb-6">
              <div className="h-10 bg-muted rounded w-3/4 mx-auto mb-2 animate-pulse"></div>
              <div className="h-6 bg-muted rounded w-1/2 mx-auto animate-pulse"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="text-center p-4 bg-muted/20 rounded-lg">
                  <div className="h-6 bg-muted rounded mx-auto mb-2 w-6 animate-pulse"></div>
                  <div className="h-4 bg-muted rounded w-3/4 mx-auto mb-1 animate-pulse"></div>
                  <div className="h-4 bg-muted rounded w-1/2 mx-auto animate-pulse"></div>
                </div>
              ))}
            </div>
          </Card>

          {/* Voting section skeleton */}
          <Card className="p-8">
            <div className="h-8 bg-muted rounded w-48 mx-auto mb-6 animate-pulse"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="p-6">
                  <div className="h-6 bg-muted rounded w-3/4 mb-4 animate-pulse"></div>
                  <div className="h-10 bg-muted rounded w-full animate-pulse"></div>
                </Card>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!election) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background/50 to-primary/5 flex items-center justify-center">
        <Card className="p-8 text-center">
          <p className="text-muted-foreground mb-4">{t('elections.electionNotFound')}</p>
          <Button onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('elections.backToElections')}
          </Button>
        </Card>
      </div>
    );
  }

  const electionStarted = Math.floor(Date.now() / 1000) >= election.startTime;
  const electionEnded = !election.active || Math.floor(Date.now() / 1000) > election.endTime;
  const maxVotes = Math.max(...candidates.map(c => c.votes), 1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/50 to-primary/5">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={onBack} className="border-primary/20">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('elections.backToElections')}
            </Button>
          </div>
          <div className="flex gap-4">
            <LanguageSelector />
            <VoiceControls />
          </div>
        </div>

        {/* Election Info */}
        <Card className="p-8 mb-8 bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-xl border-primary/30">
          <div className="text-center mb-6">
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {election.title}
            </h1>
            <p className="text-muted-foreground text-lg">{election.description}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-primary/10 rounded-lg">
              <Calendar className="w-6 h-6 mx-auto mb-2 text-primary" />
              <p className="text-sm text-muted-foreground">{t('elections.startTime')}</p>
              <p className="font-semibold">{formatDate(election.startTime)}</p>
            </div>
            <div className="text-center p-4 bg-accent/10 rounded-lg">
              <Clock className="w-6 h-6 mx-auto mb-2 text-accent" />
              <p className="text-sm text-muted-foreground">{t('elections.endTime')}</p>
              <p className="font-semibold">{formatDate(election.endTime)}</p>
            </div>
            <div className="text-center p-4 bg-success/10 rounded-lg">
              <Users className="w-6 h-6 mx-auto mb-2 text-success" />
              <p className="text-sm text-muted-foreground">{t('elections.candidates')}</p>
              <p className="font-semibold">{election.candidatesCount}</p>
            </div>
            <div className="text-center p-4 bg-primary-glow/10 rounded-lg">
              <BarChart3 className="w-6 h-6 mx-auto mb-2 text-primary-glow" />
              <p className="text-sm text-muted-foreground">{t('admin.totalVotes')}</p>
              <p className="font-semibold">{election.totalVotes}</p>
            </div>
          </div>

          {!electionStarted && (
            <div className="text-center p-4 bg-warning/10 rounded-lg">
              <Clock className="w-8 h-8 mx-auto mb-2 text-warning" />
              <p className="text-lg font-semibold">{t('elections.notStarted')}</p>
            </div>
          )}

          {electionStarted && !electionEnded && (
            <div className="text-center p-4 bg-success/10 rounded-lg">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-success" />
              <p className="text-lg font-semibold">{t('voting.electionActive')}</p>
              <p className="text-sm text-muted-foreground">
                {t('voting.timeRemaining')}: {formatTimeLeft(timeLeft)}
              </p>
            </div>
          )}

          {electionEnded && (
            <div className="text-center p-4 bg-muted/20 rounded-lg">
              <Trophy className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-lg font-semibold">{t('voting.electionEnded')}</p>
              {winner && (
                <p className="text-sm text-muted-foreground">
                  {t('voting.winner')}: {winner.name} ({winner.votes} {t('voting.candidateVotes')})
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Voting Section - Coercion Resistant: Always show voting option until deadline */}
        {electionStarted && !electionEnded && (
          <div className="space-y-6 mb-8">
            {/* Show neutral confirmation after voting, but still allow re-voting */}
            {hasVoted && (
              <Card className="p-6 bg-gradient-to-br from-success/10 to-success/5 border-success/30 mb-6">
                <div className="text-center">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3 text-success" />
                  <h3 className="text-xl font-semibold text-success mb-2">Vote Successfully Recorded</h3>
                  <p className="text-muted-foreground text-sm">
                    Your vote has been securely recorded on the blockchain.
                  </p>
                  <p className="text-muted-foreground text-xs mt-2">
                    You may update your vote until the deadline if you wish.
                  </p>
                </div>
              </Card>
            )}
            
            {/* Step 1: Connect Wallet */}
            {!isConnected ? (
              <Card className="p-8 bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-xl border-primary/30">
                <h2 className="text-2xl font-bold mb-6 text-center bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  {t('voting.vote')}
                </h2>
                <div className="text-center">
                  <Wallet className="w-16 h-16 mx-auto mb-4 text-primary" />
                  <p className="text-lg text-muted-foreground mb-6 font-semibold">
                    Click here to connect your wallet
                  </p>
                  <Button 
                    onClick={connectWallet} 
                    size="lg" 
                    className="w-full md:w-auto bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity"
                  >
                    <Wallet className="w-5 h-5 mr-2" />
                    Connect Wallet
                  </Button>
                </div>
              </Card>
            ) : !govtIdAuthenticated ? (
              /* Step 2: Government ID Login */
              <Card className="p-8 bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-xl border-primary/30">
                <h2 className="text-2xl font-bold mb-4 text-center bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Verify Your Identity
                </h2>
                <p className="text-center text-muted-foreground mb-6">
                  Now login with your Voter ID, PAN Card, or Aadhar Number
                </p>
                
                <div className="max-w-md mx-auto space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Select ID Type</label>
                    <select
                      value={govtIdType}
                      onChange={(e) => setGovtIdType(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg border border-primary/20 bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="voter">Voter ID</option>
                      <option value="pan">PAN Card</option>
                      <option value="aadhar">Aadhar Number</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {govtIdType === 'voter' && 'Voter ID Number'}
                      {govtIdType === 'pan' && 'PAN Card Number'}
                      {govtIdType === 'aadhar' && 'Aadhar Number'}
                    </label>
                    <Input
                      type="text"
                      value={govtId}
                      onChange={(e) => setGovtId(e.target.value)}
                      placeholder={
                        govtIdType === 'voter' ? 'Enter Voter ID' :
                        govtIdType === 'pan' ? 'Enter PAN Number' :
                        'Enter Aadhar Number'
                      }
                      className="w-full"
                    />
                  </div>
                  
                  <Button 
                    onClick={handleGovtIdLogin}
                    size="lg"
                    className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity"
                  >
                    Verify & Continue
                  </Button>
                  
                  <p className="text-xs text-center text-muted-foreground mt-4">
                    🔒 Demo Mode: Enter any ID number for testing
                  </p>
                </div>
              </Card>
            ) : !emailCollected ? (
              /* Step 3: Collect Email and Name */
              <EmailService
                electionTitle={election.title}
                onEmailCollected={handleEmailCollected}
              />
            ) : (
              /* Step 4: Vote for Candidate - Always visible until deadline */
              <Card className="p-8 bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-xl border-primary/30">
                <div className="mb-4 p-3 bg-success/10 rounded-lg text-center">
                  <p className="text-sm text-success">
                    ✓ Wallet Connected | ✓ ID Verified
                  </p>
                </div>
                <h2 className="text-2xl font-bold mb-6 text-center bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  {hasVoted ? 'Update Your Vote' : t('voting.selectCandidate')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {candidates.map((candidate) => (
                    <Card key={candidate.id} className="p-6 border-primary/20 hover:border-primary/50 transition-colors">
                      <h3 className="text-xl font-semibold mb-4">{candidate.name}</h3>
                      <Button
                        onClick={() => vote(candidate.id)}
                        disabled={isVoting}
                        className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90"
                      >
                        <VoteIcon className="w-4 h-4 mr-2" />
                        {isVoting ? t('voting.voting') : t('voting.vote')}
                      </Button>
                    </Card>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Results Section - Only show after election ends */}
        {electionEnded && (
          <Card className="p-8">
            <h2 className="text-2xl font-bold mb-6 text-center">{t('voting.results')}</h2>
            
            {candidates.length === 0 ? (
              <p className="text-center text-muted-foreground">{t('voting.noVotes')}</p>
            ) : (
              <div className="space-y-4">
                {candidates
                  .sort((a, b) => b.votes - a.votes)
                  .map((candidate, index) => {
                    const percentage = election.totalVotes > 0 ? (candidate.votes / election.totalVotes) * 100 : 0;
                    return (
                      <div key={candidate.id} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{candidate.name}</span>
                            {index === 0 && election.totalVotes > 0 && (
                              <Badge variant="default">
                                <Trophy className="w-3 h-3 mr-1" />
                                {t('voting.winner')}
                              </Badge>
                            )}
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {candidate.votes} {t('voting.candidateVotes')} ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <Progress value={percentage} className="h-3" />
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>
        )}

        {/* Show message when election is active but results are hidden */}
        {electionStarted && !electionEnded && (
          <Card className="p-8 text-center">
            <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">{t('voting.resultsHidden')}</h3>
            <p className="text-muted-foreground">
              {t('voting.resultsAvailableAfter')} {formatDate(election.endTime)}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ElectionVoting;