import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";


const stylesheet = readFileSync(
    path.join(process.cwd(), "src", "styles", "app.css"),
    "utf8"
);


describe("Типографіка інтерфейсу", () => {
    it("використовує спільні читабельні рівні шрифтів", () => {
        expect(stylesheet).toContain("--font-caption: 11px");
        expect(stylesheet).toContain("--font-meta: 12px");
        expect(stylesheet).toContain("--font-body: 13px");
        expect(stylesheet).toContain("--font-control: 14px");
    });

    it("не повертає прямі розміри менші за 11px", () => {
        const directSizes = Array.from(stylesheet.matchAll(
            /font-size:\s*([\d.]+)px/g
        ), (match) => Number(match[1]));
        const shorthandSizes = Array.from(stylesheet.matchAll(
            /font:\s*([\d.]+)px(?:\/|\s)/g
        ), (match) => Number(match[1]));

        expect([...directSizes, ...shorthandSizes].filter((size) => size < 11))
            .toEqual([]);
    });
});
