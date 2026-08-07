import { describe, expect, it } from "vitest";
import { CLI_EXIT, runCli } from "./run.js";
import { TILTMETER_VERSION } from "../core/version.js";

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    },
  };
}

const ENV = { cwd: "/tmp", env: {} };

describe("runCli", () => {
  it("prints the version and exits clean on --version", async () => {
    const { io, out } = makeIo();
    const code = await runCli(["--version"], io, ENV);
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.join("\n")).toContain(TILTMETER_VERSION);
  });

  it("prints help and exits clean on --help", async () => {
    const { io, out } = makeIo();
    const code = await runCli(["--help"], io, ENV);
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.join("\n")).toContain("tiltmeter");
  });

  it("exits with a usage code on an unknown option", async () => {
    const { io, err } = makeIo();
    const code = await runCli(["--not-a-real-flag"], io, ENV);
    expect(code).toBe(CLI_EXIT.USAGE);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });
});
