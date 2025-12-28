import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AnomalyState {
  faceCount: number;
  faceDetected: boolean;
  faceLost: boolean;
  cameraBlocked: boolean;
  highMotion: boolean;
  environmentStable: boolean;
  anomalyFlags: string[];
  riskScore: number;
  status: 'normal' | 'flagged' | 'warning' | 'analyzing' | 'idle';
  isAnalyzing: boolean;
  error: string | null;
}

export interface VoteMetadata {
  riskScore: number;
  anomalyFlags: boolean;
  flagHistory: string[];
  analysisCount: number;
  maxRiskScore: number;
}

const initialState: AnomalyState = {
  faceCount: 0,
  faceDetected: false,
  faceLost: false,
  cameraBlocked: false,
  highMotion: false,
  environmentStable: true,
  anomalyFlags: [],
  riskScore: 0,
  status: 'idle',
  isAnalyzing: false,
  error: null,
};

export function useAnomalyDetection() {
  const [state, setState] = useState<AnomalyState>(initialState);
  const [voteMetadata, setVoteMetadata] = useState<VoteMetadata>({
    riskScore: 0,
    anomalyFlags: false,
    flagHistory: [],
    analysisCount: 0,
    maxRiskScore: 0,
  });
  
  const previousStateRef = useRef<{ faceDetected: boolean; faceCount: number } | null>(null);
  const analysisCountRef = useRef(0);
  const flagHistoryRef = useRef<string[]>([]);
  const maxRiskScoreRef = useRef(0);

  const analyzeFrame = useCallback(async (frameData: string) => {
    setState(prev => ({ ...prev, isAnalyzing: true, status: 'analyzing' }));

    try {
      const { data, error } = await supabase.functions.invoke('anomaly-detection', {
        body: {
          frameData,
          previousState: previousStateRef.current,
        },
      });

      if (error) {
        console.error('Anomaly detection error:', error);
        setState(prev => ({
          ...prev,
          isAnalyzing: false,
          error: error.message,
          status: 'warning',
        }));
        return null;
      }

      // Update previous state for next comparison
      previousStateRef.current = {
        faceDetected: data.faceDetected,
        faceCount: data.faceCount,
      };

      // Track analysis count and flag history
      analysisCountRef.current += 1;
      if (data.anomalyFlags && data.anomalyFlags.length > 0) {
        flagHistoryRef.current = [...flagHistoryRef.current, ...data.anomalyFlags];
      }
      maxRiskScoreRef.current = Math.max(maxRiskScoreRef.current, data.riskScore);

      // Update state
      setState({
        faceCount: data.faceCount,
        faceDetected: data.faceDetected,
        faceLost: data.faceLost,
        cameraBlocked: data.cameraBlocked,
        highMotion: data.highMotion,
        environmentStable: !data.cameraBlocked && !data.highMotion,
        anomalyFlags: data.anomalyFlags || [],
        riskScore: data.riskScore,
        status: data.status,
        isAnalyzing: false,
        error: null,
      });

      // Update vote metadata
      setVoteMetadata({
        riskScore: data.riskScore,
        anomalyFlags: data.anomalyFlags && data.anomalyFlags.length > 0,
        flagHistory: flagHistoryRef.current,
        analysisCount: analysisCountRef.current,
        maxRiskScore: maxRiskScoreRef.current,
      });

      return data;
    } catch (err) {
      console.error('Analysis error:', err);
      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        error: err instanceof Error ? err.message : 'Analysis failed',
        status: 'warning',
      }));
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
    setVoteMetadata({
      riskScore: 0,
      anomalyFlags: false,
      flagHistory: [],
      analysisCount: 0,
      maxRiskScore: 0,
    });
    previousStateRef.current = null;
    analysisCountRef.current = 0;
    flagHistoryRef.current = [];
    maxRiskScoreRef.current = 0;
  }, []);

  const getVoteRiskData = useCallback(() => {
    return {
      riskScore: maxRiskScoreRef.current,
      anomalyFlags: flagHistoryRef.current.length > 0,
      flagDetails: [...new Set(flagHistoryRef.current)], // Unique flags
      analysisCount: analysisCountRef.current,
      isFlagged: maxRiskScoreRef.current > 50,
    };
  }, []);

  return {
    state,
    voteMetadata,
    analyzeFrame,
    reset,
    getVoteRiskData,
  };
}
