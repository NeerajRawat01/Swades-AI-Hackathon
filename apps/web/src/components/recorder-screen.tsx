"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Pause, Play, Square } from "lucide-react";

import { env } from "@my-better-t-app/env/web";
import { Button } from "@my-better-t-app/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { useRecorder, type WavChunk } from "@/hooks/use-recorder";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${tenths}`;
}

export default function RecorderScreen() {
  const [deviceId] = useState<string | undefined>();
  const uploadedChunkIdsRef = useRef<Set<string>>(new Set());
  const [transcript, setTranscript] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const {
    status,
    start,
    stop,
    pause,
    resume,
    chunks,
    elapsed,
    stream,
    lastError,
  } = useRecorder({ chunkDuration: 5, deviceId });

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isActive = isRecording || isPaused;
  const isTranscribing = pendingUploads > 0;

  const handlePrimary = useCallback(() => {
    if (isActive) {
      stop();
    } else {
      void start();
    }
  }, [isActive, start, stop]);

  const uploadChunkForTranscription = useCallback(async (chunk: WavChunk) => {
    setPendingUploads((value) => value + 1);
    setUploadError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== "string") {
            reject(new Error("Unable to read audio data."));
            return;
          }
          const split = result.split(",");
          resolve(split[1] ?? "");
        };
        reader.onerror = () => reject(new Error("Failed to read recorded chunk."));
        reader.readAsDataURL(chunk.blob);
      });

      const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/chunks/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chunkId: chunk.id,
          dataBase64: base64,
          mimeType: "audio/wav",
        }),
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const payload = (await response.json()) as {
        transcription?: string;
        transcription_error?: string;
      };

      if (payload.transcription && payload.transcription.trim().length > 0) {
        setTranscript((previous) =>
          previous.length > 0
            ? `${previous} ${payload.transcription?.trim()}`
            : payload.transcription?.trim() ?? ""
        );
      }

      if (
        payload.transcription_error &&
        !payload.transcription_error
          .toLowerCase()
          .includes("transcription completed but returned empty text")
      ) {
        setUploadError(payload.transcription_error);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload and transcribe chunk.";
      setUploadError(message);
    } finally {
      setPendingUploads((value) => Math.max(0, value - 1));
    }
  }, []);

  useEffect(() => {
    for (const chunk of chunks) {
      if (uploadedChunkIdsRef.current.has(chunk.id)) {
        continue;
      }
      uploadedChunkIdsRef.current.add(chunk.id);
      void uploadChunkForTranscription(chunk);
    }
  }, [chunks, uploadChunkForTranscription]);

  return (
    <main className="overflow-y-auto px-4 py-8">
      <div className="container mx-auto flex max-w-lg flex-col items-center gap-6">
        <div className="w-full">
          <h1 className="text-center text-2xl font-semibold tracking-tight">
            Voice Recorder & Transcription
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Record audio chunks and get live transcript from server
          </p>
        </div>

        <Card className="w-full">
          <CardHeader>
            <CardTitle>Recorder</CardTitle>
            <CardDescription>16 kHz / 16-bit PCM WAV - chunked every 5 s</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="overflow-hidden rounded-sm border border-border/50 bg-muted/20 text-foreground">
              <LiveWaveform
                active={isRecording}
                processing={isPaused}
                stream={stream}
                height={80}
                barWidth={3}
                barGap={1}
                barRadius={2}
                sensitivity={1.8}
                smoothingTimeConstant={0.85}
                fadeEdges
                fadeWidth={32}
                mode="static"
              />
            </div>

            <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
              {formatTime(elapsed)}
            </div>

            <div className="flex items-center justify-center gap-3">
              <Button
                size="lg"
                variant={isActive ? "destructive" : "default"}
                className="gap-2 px-5"
                onClick={handlePrimary}
                disabled={status === "requesting"}
              >
                {isActive ? (
                  <>
                    <Square className="size-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Mic className="size-4" />
                    {status === "requesting" ? "Requesting..." : "Record"}
                  </>
                )}
              </Button>

              {isActive ? (
                <Button
                  size="lg"
                  variant="outline"
                  className="gap-2"
                  onClick={isPaused ? resume : pause}
                >
                  {isPaused ? (
                    <>
                      <Play className="size-4" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="size-4" />
                      Pause
                    </>
                  )}
                </Button>
              ) : null}
            </div>

            {lastError ? (
              <div className="rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {lastError}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="w-full">
          <CardHeader>
            <CardTitle>Transcription</CardTitle>
            <CardDescription>
              {isTranscribing ? "Processing audio chunks..." : "Live transcript from server"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isTranscribing ? (
              <div className="mb-3 flex items-center gap-2 rounded-sm border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Transcribing... this can take a few seconds.
              </div>
            ) : null}
            <p className="min-h-12 text-sm leading-relaxed text-foreground">
              {transcript.length > 0
                ? transcript
                : "Start recording and speak to generate transcription."}
            </p>
            {uploadError ? (
              <p className="mt-3 text-xs text-destructive">{uploadError}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
