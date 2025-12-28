import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalysisResult {
  faceCount: number;
  faceDetected: boolean;
  faceLost: boolean;
  cameraBlocked: boolean;
  highMotion: boolean;
  anomalyFlags: string[];
  riskScore: number;
  status: 'normal' | 'flagged' | 'warning';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { frameData, previousState } = await req.json();
    
    if (!frameData) {
      return new Response(
        JSON.stringify({ error: 'No frame data provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create prompt for Gemini Vision
    const analysisPrompt = `You are an anomaly detection system for a voting application. Analyze this camera frame and respond ONLY with a valid JSON object (no markdown, no explanation).

Detect these observable conditions:
1. How many human faces are visible? (count them precisely)
2. Is there any indication the camera is blocked or covered?
3. Is there significant motion blur suggesting forced/violent movement?
4. Are there any signs of environmental instability (e.g., shaking, obstruction)?

Previous frame state: ${previousState ? `Face was ${previousState.faceDetected ? 'detected' : 'not detected'}, face count was ${previousState.faceCount}` : 'No previous state'}

Respond with ONLY this JSON structure:
{
  "faceCount": <number of faces visible, 0 if none>,
  "cameraBlocked": <true if camera appears blocked/covered/dark>,
  "highMotion": <true if significant motion blur or shaking detected>,
  "environmentStable": <true if environment appears stable>,
  "confidence": <0-100 confidence in analysis>
}`;

    // Call Gemini Vision API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: analysisPrompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: frameData.replace(/^data:image\/\w+;base64,/, '')
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'AI analysis failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiResult = await response.json();
    const textContent = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('Gemini raw response:', textContent);

    // Parse Gemini response
    let geminiAnalysis;
    try {
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        geminiAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError, textContent);
      // Default safe response
      geminiAnalysis = {
        faceCount: 1,
        cameraBlocked: false,
        highMotion: false,
        environmentStable: true,
        confidence: 50
      };
    }

    // Calculate risk score based on detected anomalies
    let riskScore = 0;
    const anomalyFlags: string[] = [];

    // Multiple faces detection (+40 risk)
    if (geminiAnalysis.faceCount > 1) {
      riskScore += 40;
      anomalyFlags.push(`Multiple faces detected: ${geminiAnalysis.faceCount}`);
    }

    // No face detected (+20 risk)
    if (geminiAnalysis.faceCount === 0) {
      riskScore += 20;
      anomalyFlags.push('No face detected');
    }

    // Face suddenly lost (+30 risk) - compare with previous state
    const faceLost = previousState?.faceDetected && geminiAnalysis.faceCount === 0;
    if (faceLost) {
      riskScore += 30;
      anomalyFlags.push('Face suddenly disappeared');
    }

    // Camera blocked (+30 risk)
    if (geminiAnalysis.cameraBlocked) {
      riskScore += 30;
      anomalyFlags.push('Camera appears blocked');
    }

    // High motion detected (+20 risk)
    if (geminiAnalysis.highMotion) {
      riskScore += 20;
      anomalyFlags.push('Unusual motion detected');
    }

    // Environment unstable (+10 risk)
    if (!geminiAnalysis.environmentStable) {
      riskScore += 10;
      anomalyFlags.push('Environment instability detected');
    }

    // Cap risk score at 100
    riskScore = Math.min(riskScore, 100);

    // Determine status
    let status: 'normal' | 'flagged' | 'warning' = 'normal';
    if (riskScore > 50) {
      status = 'flagged';
    } else if (riskScore > 25) {
      status = 'warning';
    }

    const result: AnalysisResult = {
      faceCount: geminiAnalysis.faceCount,
      faceDetected: geminiAnalysis.faceCount >= 1,
      faceLost,
      cameraBlocked: geminiAnalysis.cameraBlocked,
      highMotion: geminiAnalysis.highMotion,
      anomalyFlags,
      riskScore,
      status
    };

    console.log('Analysis result:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Anomaly detection error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
