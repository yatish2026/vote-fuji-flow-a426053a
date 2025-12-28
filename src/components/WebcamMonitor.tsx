import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, CameraOff, AlertTriangle, CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAnomalyDetection } from '@/hooks/useAnomalyDetection';
import { cn } from '@/lib/utils';

interface WebcamMonitorProps {
  onRiskUpdate?: (riskData: {
    riskScore: number;
    anomalyFlags: boolean;
    flagDetails: string[];
    isFlagged: boolean;
  }) => void;
  analysisInterval?: number; // ms between analyses
  autoStart?: boolean;
  showPreview?: boolean;
  compact?: boolean;
}

export function WebcamMonitor({
  onRiskUpdate,
  analysisInterval = 3000, // Analyze every 3 seconds
  autoStart = true,
  showPreview = true,
  compact = false,
}: WebcamMonitorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [previewVisible, setPreviewVisible] = useState(showPreview);

  const { state, analyzeFrame, getVoteRiskData, reset } = useAnomalyDetection();

  // Start webcam
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      streamRef.current = stream;
      setIsActive(true);
      setHasPermission(true);
    } catch (err) {
      console.error('Camera access error:', err);
      setHasPermission(false);
    }
  }, []);

  // Stop webcam
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsActive(false);
    reset();
  }, [reset]);

  // Capture frame and analyze
  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !isActive) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current frame
    ctx.drawImage(video, 0, 0);

    // Convert to base64
    const frameData = canvas.toDataURL('image/jpeg', 0.7);

    // Analyze frame
    const result = await analyzeFrame(frameData);

    // Notify parent of risk update
    if (result && onRiskUpdate) {
      onRiskUpdate(getVoteRiskData());
    }
  }, [isActive, analyzeFrame, getVoteRiskData, onRiskUpdate]);

  // Auto-start camera
  useEffect(() => {
    if (autoStart) {
      startCamera();
    }
    return () => stopCamera();
  }, [autoStart, startCamera, stopCamera]);

  // Start periodic analysis when camera is active
  useEffect(() => {
    if (isActive) {
      // Initial analysis after a short delay
      const initTimeout = setTimeout(captureAndAnalyze, 1000);

      // Periodic analysis
      intervalRef.current = setInterval(captureAndAnalyze, analysisInterval);

      return () => {
        clearTimeout(initTimeout);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [isActive, analysisInterval, captureAndAnalyze]);

  // Status indicator component
  const StatusIndicator = ({ 
    condition, 
    label, 
    invertedLogic = false 
  }: { 
    condition: boolean; 
    label: string; 
    invertedLogic?: boolean;
  }) => {
    const isGood = invertedLogic ? !condition : condition;
    return (
      <div className={cn(
        "flex items-center gap-2 text-sm px-3 py-1.5 rounded-full",
        isGood 
          ? "bg-green-500/10 text-green-400" 
          : "bg-red-500/10 text-red-400"
      )}>
        {isGood ? (
          <CheckCircle className="w-4 h-4" />
        ) : (
          <AlertTriangle className="w-4 h-4" />
        )}
        <span>{label}</span>
      </div>
    );
  };

  // Render permission denied state
  if (hasPermission === false) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
        <CameraOff className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-400 font-medium">Camera Access Required</p>
        <p className="text-sm text-muted-foreground mt-1">
          Please allow camera access for secure voting verification
        </p>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={startCamera}
          className="mt-3"
        >
          <Camera className="w-4 h-4 mr-2" />
          Retry Camera Access
        </Button>
      </div>
    );
  }

  // Compact mode for inline display
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Hidden video element */}
        <video ref={videoRef} className="hidden" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />

        {/* Status indicators */}
        {state.status === 'analyzing' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Analyzing...</span>
          </div>
        ) : (
          <>
            <StatusIndicator 
              condition={state.faceDetected} 
              label="Face detected" 
            />
            <StatusIndicator 
              condition={state.faceCount === 1} 
              label="Single voter" 
            />
            <StatusIndicator 
              condition={state.environmentStable} 
              label="Environment stable" 
            />
          </>
        )}

        {/* Risk score badge */}
        {state.riskScore > 0 && (
          <div className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium",
            state.status === 'flagged' 
              ? "bg-red-500/20 text-red-400"
              : state.status === 'warning'
              ? "bg-yellow-500/20 text-yellow-400"
              : "bg-green-500/20 text-green-400"
          )}>
            Risk: {state.riskScore}%
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card/50 backdrop-blur border border-border/50 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Camera className={cn(
            "w-5 h-5",
            isActive ? "text-green-400" : "text-muted-foreground"
          )} />
          <span className="font-medium text-sm">Voting Verification</span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPreviewVisible(!previewVisible)}
          >
            {previewVisible ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </Button>
          {!isActive ? (
            <Button size="sm" onClick={startCamera}>
              <Camera className="w-4 h-4 mr-1" />
              Start
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={stopCamera}>
              <CameraOff className="w-4 h-4 mr-1" />
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Video preview */}
      {previewVisible && (
        <div className="relative aspect-video bg-black/50">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />
          {!isActive && (
            <div className="absolute inset-0 flex items-center justify-center">
              <CameraOff className="w-12 h-12 text-muted-foreground" />
            </div>
          )}
          
          {/* Analysis overlay */}
          {state.isAnalyzing && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
              <div className="flex items-center gap-2 bg-black/50 px-4 py-2 rounded-full">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-white">Analyzing...</span>
              </div>
            </div>
          )}

          {/* Risk badge overlay */}
          {state.riskScore > 0 && !state.isAnalyzing && (
            <div className={cn(
              "absolute top-3 right-3 px-3 py-1 rounded-full text-sm font-bold",
              state.status === 'flagged' 
                ? "bg-red-500 text-white"
                : state.status === 'warning'
                ? "bg-yellow-500 text-black"
                : "bg-green-500 text-white"
            )}>
              Risk: {state.riskScore}%
            </div>
          )}
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />

      {/* Status indicators */}
      <div className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <StatusIndicator 
            condition={state.faceDetected} 
            label="Face detected" 
          />
          <StatusIndicator 
            condition={state.faceCount === 1} 
            label="Single voter present" 
          />
          <StatusIndicator 
            condition={state.environmentStable} 
            label="Environment stable" 
          />
        </div>

        {/* Anomaly alerts */}
        {state.anomalyFlags.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <div className="flex items-center gap-2 text-red-400 font-medium mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Anomalies Detected</span>
            </div>
            <ul className="text-sm text-red-300 space-y-1">
              {state.anomalyFlags.map((flag, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                  {flag}
                </li>
              ))}
            </ul>
            <p className="text-xs text-red-300/70 mt-2">
              Vote flagged for review. You may re-vote to update your choice.
            </p>
          </div>
        )}

        {/* Normal status */}
        {state.status === 'normal' && state.faceDetected && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-4 h-4" />
              <span className="font-medium">Verification Active</span>
            </div>
            <p className="text-xs text-green-300/70 mt-1">
              No anomalies detected. Proceed with your vote.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default WebcamMonitor;
