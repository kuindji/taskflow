import { expect, it } from "bun:test";
import { DataDirChangingError, DataDirGate } from "../../src/services/data-dir-gate";
import { expectRejects } from "../expect-rejects";

it("refuses new work while closed and admits it again once opened", async () => {
    const gate = new DataDirGate();
    expect(await gate.close(1_000)).toBe(true);
    let ran = false;
    const work = async () => {
        ran = true;
    };

    await expectRejects(gate.run(work), "changing its data folder");
    expect(gate.tryRun(work)).toBeNull();
    expect(ran).toBe(false);

    gate.open();
    await gate.run(work);
    expect(ran).toBe(true);
});

it("closing waits for admitted and tracked work to finish", async () => {
    const gate = new DataDirGate();
    const request = Promise.withResolvers<undefined>();
    const background = Promise.withResolvers<undefined>();
    const finished: string[] = [];
    const admitted = gate.run(async () => {
        await request.promise;
        finished.push("request");
    });
    const tracked = gate.track(
        background.promise.then(() => {
            finished.push("background");
        }),
    );

    const closing = gate.close(1_000).then((drained) => {
        finished.push("closed");
        return drained;
    });
    request.resolve(undefined);
    await admitted;
    expect(finished).toEqual(["request"]);
    background.resolve(undefined);

    expect(await closing).toBe(true);
    await tracked;
    expect(finished).toEqual(["request", "background", "closed"]);
    expect(gate.isClosed).toBe(true);
});

it("gives up and reopens when admitted work does not drain in time", async () => {
    const gate = new DataDirGate();
    const stuck = Promise.withResolvers<undefined>();
    const admitted = gate.run(() => stuck.promise);

    expect(await gate.close(10)).toBe(false);
    expect(gate.isClosed).toBe(false);
    stuck.resolve(undefined);
    await admitted;
});

it("refuses a second close while the first holds the gate", async () => {
    const gate = new DataDirGate();
    expect(await gate.close(1_000)).toBe(true);

    let error: unknown;
    try {
        await gate.close(1_000);
    } catch (caught) {
        error = caught;
    }
    expect(error).toBeInstanceOf(DataDirChangingError);
});
