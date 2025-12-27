import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { LanguageSelector } from '@/components/LanguageSelector';
import { VoiceAssistant } from '@/components/VoiceAssistant';
import { useSpeech } from '@/hooks/useSpeech';
import { Clock, Vote as VoteIcon, CheckCircle, Wallet, Shield, Zap, Globe, Activity, Calendar, Users, BarChart3, AlertCircle, ArrowLeft } from 'lucide-react';
import { ethers } from 'ethers';
import { FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI } from '../lib/contract';
import AIInsights from '@/components/AIInsights';

const Vote = () => {
  const { t } = useTranslation();
  const { speak } = useSpeech();
  const [elections, setElections] = useState([]);
  const [selectedElectionId, setSelectedElectionId] = useState(null);
  const [selectedElection, setSelectedElection] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [winner, setWinner] = useState(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [voting, setVoting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [userAddress, setUserAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingElection, setLoadingElection] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    checkWalletConnection();
    fetchElections();
  }, []);

  const fetchElections = async () => {
    try {
      setLoading(true);
      
      if (!window.ethereum) {
        setLoading(false);
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI, provider);

      const electionCount = await contract.electionCount();
      const electionsList = [];
      
      for (let i = 0; i < Number(electionCount); i++) {
        try {
          const election = await contract.elections(i);
          electionsList.push({
            id: Number(election.id),
            title: election.title,
            description: election.description,
            startTime: Number(election.startTime),
            endTime: Number(election.endTime),
            active: election.active,
            candidatesCount: Number(election.candidatesCount),
            totalVotes: Number(election.totalVotes)
          });
        } catch (error) {
          console.error('Error fetching election:', i, error);
        }
      }

      setElections(electionsList);
    } catch (error) {
      console.error('Error fetching elections:', error);
      toast({
        title: t('common.error'),
        description: 'Unable to load elections',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchElectionDetails = async (electionId) => {
    try {
      setLoadingElection(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI, provider);

      const [electionResult, candidateResults, winnerResult] = await Promise.allSettled([
        contract.getElection(electionId),
        Promise.all(
          Array.from({ length: 10 }, (_, i) => 
            contract.getCandidate(electionId, i).catch(() => null)
          )
        ),
        contract.getWinner(electionId).catch(() => null)
      ]);

      if (electionResult.status === 'fulfilled') {
        const [title, description, startTime, endTime, active, candidatesCount, totalVotes] = electionResult.value;
        
        setSelectedElection({
          id: electionId,
          title,
          description,
          startTime: Number(startTime),
          endTime: Number(endTime),
          active,
          candidatesCount: Number(candidatesCount),
          totalVotes: Number(totalVotes)
        });

        const candidatesList = [];
        if (candidateResults.status === 'fulfilled') {
          candidateResults.value
            .filter(result => result !== null)
            .forEach((result) => {
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
                console.log('Error processing candidate');
              }
            });
        }
        setCandidates(candidatesList);

        let winnerData = null;
        if (winnerResult.status === 'fulfilled' && winnerResult.value) {
          const [winnerName, winnerVotes] = winnerResult.value;
          winnerData = { name: winnerName, votes: Number(winnerVotes) };
          setWinner(winnerData);
        }

        if (userAddress) {
          checkVotingStatus(electionId, userAddress);
        }
      }
    } catch (error) {
      console.error('Error fetching election details:', error);
      toast({
        title: t('common.error'),
        description: 'Failed to load election details',
        variant: 'destructive'
      });
    } finally {
      setLoadingElection(false);
    }
  };

  const checkWalletConnection = async () => {
    try {
      if (window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.listAccounts();
        
        if (accounts.length > 0) {
          setConnected(true);
          setUserAddress(accounts[0].address);
        }
      }
    } catch (error) {
      console.error('Error checking wallet connection:', error);
    }
  };

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        toast({
          title: "Wallet Required",
          description: "Please install MetaMask or Core Wallet",
          variant: "destructive"
        });
        return;
      }

      await window.ethereum.request({ method: 'eth_requestAccounts' });
      checkWalletConnection();
      toast({
        title: "Wallet Connected",
        description: "Successfully connected to your wallet",
        variant: "default"
      });
    } catch (error) {
      console.error('Error connecting wallet:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to connect wallet",
        variant: "destructive"
      });
    }
  };

  const checkVotingStatus = async (electionId, address) => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI, provider);
      setHasVoted(false);
    } catch (error) {
      console.error('Error checking voting status:', error);
    }
  };

  const handleVoiceCommand = (command) => {
    console.log('Voice command received:', command);
    
    if (command.startsWith('VOTE:')) {
      const candidateName = command.replace('VOTE:', '').trim().toLowerCase();
      const candidate = candidates.find(c => 
        c.name.toLowerCase().includes(candidateName) || 
        candidateName.includes(c.name.toLowerCase())
      );
      
      if (candidate) {
        handleVote(candidate.id);
      } else {
        speak(t('voting.candidateNotFound', { name: candidateName }));
      }
    } else if (command === 'CONNECT_WALLET') {
      connectWallet();
    }
  };

  const handleVote = async (candidateId) => {
    try {
      setVoting(true);
      
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(FACTORY_CONTRACT_ADDRESS, FACTORY_CONTRACT_ABI, signer);

      const tx = await contract.vote(selectedElectionId, candidateId);
      toast({
        title: "Transaction Submitted",
        description: "Your vote is being processed...",
        variant: "default"
      });

      await tx.wait();
      
      // Coercion-resistant: Show neutral success message without revealing candidate
      setHasVoted(true);
      toast({
        title: "Vote Successfully Recorded",
        description: "Your vote has been securely recorded on the blockchain.",
        variant: "default"
      });

      fetchElectionDetails(selectedElectionId);
    } catch (error) {
      console.error('Error voting:', error);
      // Coercion-resistant: Allow re-voting, don't show specific error for already voted
      toast({
        title: "Vote Failed",
        description: error.message || "Failed to submit vote",
        variant: "destructive"
      });
    } finally {
      setVoting(false);
    }
  };

  const getElectionStatus = (election) => {
    const now = Math.floor(Date.now() / 1000);
    if (!election.active) return 'ended';
    if (now < election.startTime) return 'upcoming';
    if (now > election.endTime) return 'expired';
    return 'active';
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const handleElectionSelect = async (electionId) => {
    setSelectedElectionId(electionId);
    await fetchElectionDetails(electionId);
  };

  const handleBackToList = () => {
    setSelectedElectionId(null);
    setSelectedElection(null);
    setCandidates([]);
    setWinner(null);
    setHasVoted(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 pb-24">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <LanguageSelector />
        </div>

        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="p-3 bg-gradient-to-br from-primary to-primary-glow rounded-xl">
              <Shield className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-6xl font-bold bg-gradient-to-r from-primary via-primary-glow to-accent bg-clip-text text-transparent">
              {t('voting.title')}
            </h1>
            <div className="p-3 bg-gradient-to-br from-accent to-primary rounded-xl">
              <Zap className="w-8 h-8 text-primary-foreground" />
            </div>
          </div>
          <p className="text-xl text-muted-foreground mb-4">
            {t('voting.subtitle')}
          </p>
        </div>

        {!connected ? (
          <Card className="max-w-md mx-auto p-8 text-center bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-md border-accent/20 shadow-elegant">
            <div className="p-4 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full w-24 h-24 mx-auto mb-6 flex items-center justify-center">
              <Wallet className="w-12 h-12 text-accent" />
            </div>
            <h3 className="text-2xl font-semibold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Connect Web3 Wallet
            </h3>
            <p className="text-muted-foreground mb-6">
              Secure blockchain authentication required for voting
            </p>
            <Button onClick={connectWallet} size="lg" className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 transition-all duration-300">
              <Wallet className="w-5 h-5 mr-2" />
              Connect Wallet
            </Button>
          </Card>
        ) : !selectedElectionId ? (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Active Elections
            </h2>

            {loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(3)].map((_, i) => (
                  <Card key={i} className="p-6">
                    <div className="space-y-4">
                      <div className="h-6 bg-muted rounded-md w-3/4 animate-pulse"></div>
                      <div className="h-4 bg-muted rounded w-full animate-pulse"></div>
                      <div className="h-4 bg-muted rounded w-2/3 animate-pulse"></div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {!loading && elections.length === 0 && (
              <Card className="p-12 text-center">
                <VoteIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-lg text-muted-foreground">No elections available</p>
              </Card>
            )}

            {!loading && elections.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {elections.map((election) => {
                  const status = getElectionStatus(election);
                  return (
                    <Card
                      key={election.id}
                      className="p-6 cursor-pointer transition-all duration-300 hover:shadow-lg border-2 hover:border-primary/30"
                      onClick={() => handleElectionSelect(election.id)}
                    >
                      <div className="space-y-4">
                        <div className="flex justify-between items-start">
                          <h3 className="text-xl font-semibold truncate">{election.title}</h3>
                          <Badge variant={
                            status === 'active' ? 'default' :
                            status === 'upcoming' ? 'secondary' :
                            status === 'ended' ? 'outline' : 'destructive'
                          }>
                            {status === 'active' && <><CheckCircle className="w-3 h-3 mr-1" /> Active</>}
                            {status === 'upcoming' && <><Clock className="w-3 h-3 mr-1" /> Upcoming</>}
                            {status === 'ended' && <><AlertCircle className="w-3 h-3 mr-1" /> Ended</>}
                            {status === 'expired' && <><AlertCircle className="w-3 h-3 mr-1" /> Expired</>}
                          </Badge>
                        </div>
                        
                        <p className="text-muted-foreground text-sm line-clamp-2">
                          {election.description}
                        </p>
                        
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar className="w-4 h-4" />
                            <span>{formatDate(election.startTime)}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              <span>{election.candidatesCount} Candidates</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <BarChart3 className="w-4 h-4" />
                              <span>{election.totalVotes} Votes</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <Button 
              variant="outline" 
              onClick={handleBackToList}
              className="border-primary/20"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Elections
            </Button>

            {loadingElection ? (
              <Card className="p-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                  <p className="mt-4 text-muted-foreground">Loading election...</p>
                </div>
              </Card>
            ) : selectedElection ? (
              <>
                <Card className="p-8 bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-xl border-primary/30">
                  <div className="text-center mb-6">
                    <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                      {selectedElection.title}
                    </h1>
                    <p className="text-muted-foreground text-lg">{selectedElection.description}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-primary/10 rounded-lg">
                      <CheckCircle className="w-6 h-6 mx-auto mb-2 text-primary" />
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge variant={selectedElection.active ? 'default' : 'outline'}>
                        {selectedElection.active ? 'Active' : 'Ended'}
                      </Badge>
                    </div>
                    <div className="text-center p-4 bg-accent/10 rounded-lg">
                      <Users className="w-6 h-6 mx-auto mb-2 text-accent" />
                      <p className="text-sm text-muted-foreground">Candidates</p>
                      <p className="font-semibold">{selectedElection.candidatesCount}</p>
                    </div>
                    <div className="text-center p-4 bg-success/10 rounded-lg">
                      <BarChart3 className="w-6 h-6 mx-auto mb-2 text-success" />
                      <p className="text-sm text-muted-foreground">Total Votes</p>
                      <p className="font-semibold">{selectedElection.totalVotes}</p>
                    </div>
                    <div className="text-center p-4 bg-primary-glow/10 rounded-lg">
                      <CheckCircle className="w-6 h-6 mx-auto mb-2 text-primary-glow" />
                      <p className="text-sm text-muted-foreground">Winner</p>
                      <p className="font-semibold">{winner ? winner.name : '-'}</p>
                    </div>
                  </div>
                </Card>

                {/* Coercion-resistant: Show neutral confirmation but still allow re-voting */}
                {hasVoted && (
                  <Card className="p-6 mb-6 bg-gradient-to-br from-success/10 to-success/5 border-success/30">
                    <div className="text-center">
                      <CheckCircle className="w-10 h-10 mx-auto mb-3 text-success" />
                      <h3 className="text-xl font-semibold text-success mb-2">Vote Successfully Recorded</h3>
                      <p className="text-muted-foreground text-sm">Your vote has been securely recorded on the blockchain.</p>
                      <p className="text-muted-foreground text-xs mt-2">You may update your vote until the deadline if you wish.</p>
                    </div>
                  </Card>
                )}
                
                {selectedElection.active ? (
                  <Card className="p-6">
                    <h3 className="text-2xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                      {hasVoted ? 'Update Your Vote' : 'Cast Your Vote'}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {candidates.map((candidate) => (
                        <Card 
                          key={candidate.id}
                          className="p-6 hover:border-primary transition-all cursor-pointer"
                          onClick={() => handleVote(candidate.id)}
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <h4 className="font-semibold text-lg">{candidate.name}</h4>
                              <p className="text-sm text-muted-foreground">Click to vote</p>
                            </div>
                            <VoteIcon className="w-6 h-6 text-primary" />
                          </div>
                        </Card>
                      ))}
                    </div>
                  </Card>
                ) : (
                  <Card className="p-8 text-center">
                    <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-lg text-muted-foreground">This election has ended</p>
                  </Card>
                )}

                <Card className="p-6">
                  <h3 className="text-2xl font-bold mb-6 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                    Results
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {candidates.map((candidate) => {
                      const percentage = selectedElection.totalVotes > 0 
                        ? (candidate.votes / selectedElection.totalVotes) * 100 
                        : 0;
                      const isWinner = winner && winner.name === candidate.name;

                      return (
                        <Card 
                          key={candidate.id} 
                          className={`p-6 ${isWinner ? 'border-2 border-primary bg-primary/5' : ''}`}
                        >
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h4 className="font-semibold text-lg flex items-center gap-2">
                                {candidate.name}
                                {isWinner && <Badge className="bg-gradient-to-r from-primary to-accent">Winner</Badge>}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                {candidate.votes} votes ({percentage.toFixed(1)}%)
                              </p>
                            </div>
                          </div>
                          <div className="w-full bg-muted rounded-full h-3">
                            <div
                              className="bg-gradient-to-r from-primary to-accent h-3 rounded-full transition-all duration-500"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </Card>

                {selectedElection.totalVotes > 0 && (
                  <AIInsights 
                    election={selectedElection}
                    candidates={candidates}
                    winner={winner}
                  />
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
      
      {/* Voice Assistant - Full width bottom bar */}
      <VoiceAssistant />
    </div>
  );
};

export default Vote;
