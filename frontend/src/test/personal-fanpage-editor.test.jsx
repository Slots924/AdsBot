import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import PersonalFanPageEditor from "../components/PersonalFanPageEditor.jsx";
import updateBio from "../../../facebook/api-actions/updateBio.js";
import deletePost from "../../../facebook/api-actions/posts/deletePost.js";
import { withFacebookRuntime } from "../../../test/helpers/facebookRuntimePage.js";

const ok = (data) => ({ ok: true, data });
const session = { id: "session-1" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(overrides = {}) {
    window.adsBot = {
        getCountries: vi.fn().mockResolvedValue(ok([{ code: "DE", name: "Germany" }])),
        preparePersonalFanPageEdit: vi.fn().mockResolvedValue(ok({ actorId: "200", photos: [] })),
        editPersonalFanPage: vi.fn().mockResolvedValue(ok({ success: true })),
        stopPersonalFanPageEdit: vi.fn().mockResolvedValue(ok({ stopped: true })),
        ...overrides,
    };
    function Editor() {
        const [busy, setBusy] = useState("");
        return <PersonalFanPageEditor session={session} busy={busy} setBusy={setBusy} />;
    }
    render(<Editor />);
    return window.adsBot;
}

describe("Редагування фанпейджі", () => {
    it("заповнює локальні дані для вибраного гео", async () => {
        const api = setup({ generatePersonalFanPageData: vi.fn().mockResolvedValue(ok({
            firstName: "Laura", lastName: "Hensley", company: "Studio", profession: "Designer", university: "College",
            email: "laura@example.com", instagram: "@laura.hensley",
        })) });
        fireEvent.click(screen.getByRole("button", { name: "Гео для даних фанпейджі" }));
        fireEvent.click((await screen.findByText("Germany")).closest("button"));
        fireEvent.click(screen.getByRole("button", { name: "Згенерувати дані" }));
        await screen.findByText("Дані заповнено");
        expect(api.generatePersonalFanPageData).toHaveBeenCalledWith({ geo: "DE" });
        expect(screen.getByLabelText("Ім’я / назва фанпейджі")).toHaveValue("Laura Hensley");
        expect(screen.getByRole("textbox", { name: "Компанія" })).toHaveValue("Studio");
        expect(screen.getByRole("textbox", { name: "Емейл" })).toHaveValue("laura@example.com");
        expect(screen.getByLabelText("@назва_акаунта")).toHaveValue("@laura.hensley");
    });

    it("очищає порожнє біо й пропускає решту порожніх увімкнених полів", async () => {
        const api = setup();
        fireEvent.click(screen.getByRole("button", { name: "Застосувати вибрані зміни" }));
        await screen.findByText("Усі вибрані зміни виконано");
        expect(api.editPersonalFanPage).toHaveBeenCalledTimes(1);
        expect(api.editPersonalFanPage).toHaveBeenCalledWith(session.id, expect.objectContaining({ action: "bio", value: "", actorId: "200" }));
    });

    it("просить пароль і повторює ту саму зміну назви без розкриття пароля у формі", async () => {
        const api = setup({ editPersonalFanPage: vi.fn()
            .mockResolvedValueOnce({ ok: false, error: { code: "FACEBOOK_PASSWORD_REQUIRED", message: "Потрібен пароль" } })
            .mockResolvedValueOnce(ok({ success: true })) });
        fireEvent.change(screen.getByLabelText("Ім’я / назва фанпейджі"), { target: { value: "Laura Hensley" } });
        fireEvent.click(screen.getByRole("button", { name: "Змінити", exact: true }));
        const password = await screen.findByLabelText("Пароль Facebook");
        fireEvent.change(password, { target: { value: "test-credential" } });
        fireEvent.click(screen.getByRole("button", { name: "Змінити назву" }));
        await screen.findByText("Назву успішно змінено");
        expect(api.preparePersonalFanPageEdit).toHaveBeenCalledTimes(1);
        expect(api.editPersonalFanPage).toHaveBeenLastCalledWith(session.id, { action: "name", actorId: "200", name: "Laura Hensley", password: "test-credential" });
        expect(screen.queryByLabelText("Пароль Facebook")).toBeNull();
    });

    it("відображає заглушку як невиконаний пункт та продовжує наступні", async () => {
        const api = setup({ editPersonalFanPage: vi.fn(async (_id, action) => ok(action.action === "instagram"
            ? { success: false, status: "NOT_IMPLEMENTED", error: "Ще не реалізовано для фанпейджі" }
            : { success: true })) });
        fireEvent.change(screen.getByLabelText("@назва_акаунта"), { target: { value: "@laura.hensley" } });
        fireEvent.change(screen.getByRole("textbox", { name: "Емейл" }), { target: { value: "laura@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Застосувати вибрані зміни" }));
        await screen.findByText("Завершено. Невиконаних пунктів: 1");
        expect(api.editPersonalFanPage.mock.calls.map(([, payload]) => payload.action)).toEqual(["bio", "instagram", "email"]);
    });

    it("не запускає наступні зміни після натискання зупинки", async () => {
        let finish;
        const api = setup({ editPersonalFanPage: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
        fireEvent.change(screen.getByRole("textbox", { name: "Емейл" }), { target: { value: "laura@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Застосувати вибрані зміни" }));
        await waitFor(() => expect(api.editPersonalFanPage).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole("button", { name: "Зупинити" }));
        finish(ok({ success: true }));
        await screen.findAllByText("Зупинено");
        expect(api.editPersonalFanPage).toHaveBeenCalledTimes(1);
        expect(api.stopPersonalFanPageEdit).toHaveBeenCalledWith(session.id);
    });
});

describe("Actor фанпейджі", () => {
    it("використовує av для біо та видалення, зберігаючи __user основного акаунта в запиті", async () => {
        const requests = [];
        const page = withFacebookRuntime({ evaluate: async (_fn, args) => {
            requests.push(new URLSearchParams(args.requestBody));
            return { ok: true, statusCode: 200, body: JSON.stringify({ data: {} }) };
        } }, { runtime: { av: "200", __user: "100" } });
        await updateBio({ page, collectionToken: "collection", sectionToken: "section", value: "Hello" });
        await deletePost({ page, storyId: "story-1", clientMutationId: "1" });
        expect(requests).toHaveLength(2);
        for (const body of requests) {
            expect(body.get("__user")).toBe("100");
            expect(JSON.parse(body.get("variables")).input.actor_id).toBe("200");
        }
    });
});
