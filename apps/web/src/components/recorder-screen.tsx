"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Mic, Pause, Play, Square, Trash2 } from "lucide-react";

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

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)}s`;
}

function ChunkRow({ chunk, index }: { chunk: WavChunk; index: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }
    if (playing) {
      audioElement.pause();
      audioElement.currentTime = 0;
      setPlaying(false);
    } else {
      void audioElement.play();
      setPlaying(true);
    }
  };

  const download = () => {
    const anchor = document.createElement("a");
    anchor.href = chunk.url;
    anchor.download = `chunk-${index + 1}.wav`;
    anchor.click();
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/30 px-3 py-2">
      <audio
        ref={audioRef}
        src={chunk.url}
        onEnded={() => setPlaying(false)}
        preload="none"
      />
      <span className="text-xs font-medium text-muted-foreground tabular-nums">
        #{index + 1}
      </span>
      <span className="text-xs tabular-nums">{formatDuration(chunk.duration)}</span>
      <span className="text-[10px] text-muted-foreground">16kHz PCM</span>
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="icon-xs" onClick={toggle}>
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={download}>
          <Download className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export default function RecorderScreen() {
  const [deviceId] = useState<string | undefined>();
  const uploadedChunkIdsRef = useRef<Set<string>>(new Set());
  const [transcript, setTranscript] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const {
    status,
    start,
    stop,
    pause,
    resume,
    chunks,
    elapsed,
    stream,
    clearChunks,
    lastError,
  } = useRecorder({ chunkDuration: 5, deviceId });

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isActive = isRecording || isPaused;

  const handlePrimary = useCallback(() => {
    if (isActive) {
      stop();
    } else {
      void start();
    }
  }, [isActive, start, stop]);

  const uploadChunkForTranscription = useCallback(async (chunk: WavChunk) => {
    setIsTranscribing(true);
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
      setIsTranscribing(false);
    }
  }, []);

  const handleClearAll = useCallback(() => {
    clearChunks();
    uploadedChunkIdsRef.current.clear();
    setTranscript("");
    setUploadError(null);
  }, [clearChunks]);

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
              {isTranscribing ? "Uploading and transcribing..." : "Live transcript from server"}
            </CardDescription>
          </CardHeader>
          <CardContent>
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

        {chunks.length > 0 ? (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Chunks</CardTitle>
              <CardDescription>{chunks.length} recorded</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {chunks.map((chunk, index) => (
                <ChunkRow key={chunk.id} chunk={chunk} index={index} />
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 gap-1.5 self-end text-destructive"
                onClick={handleClearAll}
              >
                <Trash2 className="size-3" />
                Clear all
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
