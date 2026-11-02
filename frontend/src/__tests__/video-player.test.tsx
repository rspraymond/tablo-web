import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VideoPlayer } from "../components/VideoPlayer";
import { api } from "../api/tablo";
import type { Channel } from "../api/tablo";

vi.mock("../api/tablo", () => ({
  api: {
    startStream: vi.fn(),
    stopStream: vi.fn(),
  },
}));

const channel: Channel = {
  identifier: "test-channel",
  call_sign: "TEST",
  major: 1,
  minor: 1,
  network: "Test",
  kind: "ott",
  display_name: "Test Channel",
};

describe("VideoPlayer volume", () => {
  beforeEach(() => {
    vi.mocked(api.startStream).mockResolvedValue({
      session_id: "s1",
      proxy_url: "/api/stream/s1",
      stream_url: "/api/stream/s1.m3u8",
    });
    vi.mocked(api.stopStream).mockResolvedValue({ ok: true });
  });

  it("unmutes the video at the chosen level when the slider moves above 0", async () => {
    const { container } = render(<VideoPlayer channel={channel} onClose={() => {}} />);
    const slider = await screen.findByRole("slider");
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video!.muted).toBe(true); // starts muted for autoplay

    fireEvent.change(slider, { target: { value: "0.5" } });

    expect(video!.muted).toBe(false);
    expect(video!.volume).toBe(0.5);
  });

  it("keeps the keydown listener registered once across volume changes", async () => {
    render(<VideoPlayer channel={channel} onClose={() => {}} />);
    const slider = await screen.findByRole("slider");

    // The keyboard effect must not tear down and re-register the global
    // keydown listener on every slider tick: that churn is what made Chrome
    // stutter while dragging the volume.
    const addSpy = vi.spyOn(window, "addEventListener");
    const keydownAdds = () => addSpy.mock.calls.filter((c) => c[0] === "keydown").length;
    const baseline = keydownAdds();

    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.change(slider, { target: { value: "0.25" } });

    expect(keydownAdds()).toBe(baseline);
    addSpy.mockRestore();
  });

  it("steps volume from the current level on ArrowUp after a slider change", async () => {
    const { container } = render(<VideoPlayer channel={channel} onClose={() => {}} />);
    const slider = await screen.findByRole("slider");
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.keyDown(window, { key: "ArrowUp" });

    expect(video!.volume).toBe(0.55);
  });
});