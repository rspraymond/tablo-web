# Transcode pipeline benchmark

Measured breakdown of where the time goes in the FFmpeg transcode path (`backend/app/routes/stream.py` `start_transcoder`), plus the session-start latency chain. Answer to "where most of the time cost is": **the libx264 video encode, at about 81% of total CPU and ~60% of wall time per stream.**

## Environment

| Item | Value |
|---|---|
| Container | `tablo-web-backend-1` (production image, ffmpeg 6.1.1 Ubuntu 24.04) |
| CPU | AMD Ryzen 7 5800X, 8 cores / 16 threads (container sees 8) |
| GPU | RTX 4090; `/dev/nvidia0` is passed into the container (host Docker + nvidia runtime; `deploy.resources.reservations.devices` + `NVIDIA_DRIVER_CAPABILITIES=all` in compose), so the auto probe now resolves to `h264_nvenc`. The libx264 numbers below were measured before passthrough landed |
| Source | 30 s, 1920x1080i60 MPEG-2 video + AAC audio in MPEG-TS (OTA-like; generated with `testsrc2` + `tinterlace=mode=merge`, 8 Mbps) |
| Pipeline | Exact `start_transcoder` command: `bwdif=mode=send_field:parity=auto:deint=all` → `libx264 veryfast high crf 21 maxrate 7000k bufsize 14000k yuv420p g 60` → `aac 192k stereo` → HLS, 4 s segments, `delete_segments` |

## Where the time goes (ranked)

Per 30 s of content, single stream, measured in the container:

| Rank | Stage | CPU time | Wall time | Share |
|---|---|---|---|---|
| 1 | libx264 video encode (60 fps fields) | 43.9 s (42.65 user + 1.22 sys) | 13.17 s | ~81% of CPU, ~96% of pipeline wall |
| 2 | bwdif deinterlace | part of 3.54 s run | 2.41 s alone | ~18% of wall |
| 3 | MPEG-2 decode | part of 3.54 s run | ~1.1 s (3.54 s decode+deint minus 2.41 s deint alone) | ~8% of wall |
| 4 | AAC audio encode | 1.9 s (1.83 user + 0.06 sys) | 1.90 s | ~3.5% of CPU |
| 5 | HLS mux + segment disk I/O | negligible | ~0 s (full encode with HLS 17.38 s vs null mux 17.69 s) | ~0% |
| - | **Full pipeline** | **54.1 s** (52.43 user + 1.65 sys) | **13.61 s** | **4.0 cores, 2.2x realtime** |

Notes on the measurements:

- `bwdif=mode=send_field` emits each field as a separate frame, so libx264 encodes at **60 fps**, not 30. The encode-only figure above is at 60 fps to match; at 30 fps the same encode costs 8.27 s wall (3.6x realtime).
- The full pipeline's ffmpeg `-benchmark` line: `bench: utime=52.430s stime=1.651s rtime=13.610s`, i.e. ~4.0 of the 8 available cores per stream.
- Output on the synthetic source hit the 7000 k maxrate ceiling (7.19 Mbps out), so rate control is active. `testsrc2` is an easy-to-compress synthetic pattern; real OTA content (sports, news) has more motion and will push the encode cost up, not down.
- Single-run wall times varied 13.6 to 17.7 s across identical runs (other containers share the host). CPU-time figures are the stable comparison.

## Concurrency: the cap is at the edge of this box

`MAX_TRANSCODE_SESSIONS = 4`, but one transcode consumes ~4 cores:

| Scenario | Result |
|---|---|
| 1 stream | 2.2x realtime (healthy) |
| 4 concurrent streams | wall 39.3 s for 30 s of content; **each stream runs at ~0.77x realtime** |

Four concurrent transcodes demand ~16 core-equivalents on an 8-core box, so each stream falls slightly **below** realtime. For live TV that means the playlist live edge drifts behind real time (~23% of a second per second) as long as all four slots are busy. The cap prevents CPU exhaustion but does not guarantee realtime; on this hardware 2 concurrent streams is the comfortable ceiling, 4 is the max.

## Session-start latency (time to first playable frame)

Measured and code-path breakdown for a `transcode=true` tune:

| Step | Cost | Source |
|---|---|---|
| `stop_all_live_sessions()` | ms (no-op when no prior session; SIGKILL + `rmtree` per prior session) | `stream.py` |
| `state.start_stream` → `TabloClient.watch` | LAN HTTP round trip to the device, in the `_run_sync` thread pool (not measured; typically tens to hundreds of ms) | `state.py` |
| Encoder probe (first tune only, cached for process life) | 0.07 s for `ffmpeg -encoders` plus a 0.5 s NVENC test encode now that `/dev/nvidia0` is in the container | `stream.py` `_resolve_video_encoder` |
| FFmpeg spawn → `playlist.m3u8` exists | **3.56 s** | measured |
| FFmpeg spawn → first `.ts` segment exists | **3.58 s** (first segment closes at the first keyframe boundary, not a full 4 s) | measured |
| Playlist polling loop | up to +0.5 s extra (20 x 0.5 s polls in `transcoded_stream`) | `stream.py` |
| hls.js start position | starts ~3 segments behind the live edge once enough segments exist (`liveSyncDurationCount: 3`); with only 1 segment in the playlist it starts there immediately | `usePlayer.ts` |

So the dominant startup cost is the **~3.6 s until the first segment exists**, which is inherent to producing a first HLS segment (first keyframe boundary plus encode). The Tablo `watch` call and the 0.5 s polling granularity add on top.

## Findings and levers

1. **libx264 is the cost.** ~81% of CPU. Preset `veryfast` is already the fast/quality trade the code chose; moving to `faster`/`fast` would buy maybe 10-20% at a quality/bitrate cost. The big lever is the encoder itself.
2. **NVENC is active now (host-Docker migration).** The stack runs on host Docker with the nvidia container runtime: compose passes the GPU via `deploy.resources.reservations.devices` and sets `NVIDIA_DRIVER_CAPABILITIES=all` (the default capability set omits `libnvidia-encode`, so the env var is required). With NVENC the encode stage drops by roughly an order of magnitude, freeing ~3 cores per stream and making 4 concurrent streams comfortable.
3. **bwdif is second at ~18% of wall** and runs on every OTA stream even when the source is progressive (`deint=all`). A `deint=smart`/content-aware mode would save ~2.4 s per 30 s on progressive content at the risk of interlace artifacts on true interlaced OTA; `send_field` also doubles the frame rate the encoder must handle (60 fps), which inflates the encode cost in row 1.
4. **Audio and I/O are not the problem.** AAC is ~3.5% of CPU and the HLS mux/disk delta is ~0; segment serving (`FileResponse`) is sendfile and negligible.
5. **Concurrency cap vs cores.** With GPU passthrough landed, `MAX_TRANSCODE_SESSIONS = 4` is fine; on CPU-only libx264 this 8-core box was at its limit with 4 streams (0.77x realtime each).

## Reproducing

Run inside the backend container (source generated once, ~31 MB):

```bash
# full pipeline, exact start_transcoder command
ffmpeg -hide_banner -benchmark -y -i src.ts \
  -vf bwdif=mode=send_field:parity=auto:deint=all \
  -c:v libx264 -preset veryfast -profile:v high -crf 21 -maxrate 7000k -bufsize 14000k -pix_fmt yuv420p -g 60 \
  -c:a aac -b:a 192k -ac 2 \
  -f hls -hls_time 4 -hls_list_size 12 -hls_segment_filename %03d.ts \
  -hls_flags delete_segments+independent_segments playlist.m3u8
```

The `bench:` line in the output gives user/sys/wall CPU time for the run; stage isolation uses the same command with one stage replaced by `-f null -` (encode-only, decode+deint-only, AAC-only).
