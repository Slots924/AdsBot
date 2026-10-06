import { describe, expect, it } from "vitest";
import { postLikeAreaSelector } from "../../../facebook/selectors/post.js";
import { reactionButtonSelector } from "../../../facebook/selectors/reactions.js";


describe("Кнопка реакції відкритого поста", () => {
    for (const selector of [postLikeAreaSelector, reactionButtonSelector]) {
        it(`вибирає кнопки реакції лише в модальному пості: ${selector}`, () => {
            const fixture = document.createElement("div");
            fixture.innerHTML = `
                <div role="button" aria-label="Like" id="outside"></div>
                <div role="dialog" aria-modal="true" aria-labelledby="post-title">
                    <div data-visualcompletion="ignore-dynamic">
                        <div role="button" aria-label="lIkE" id="like"></div>
                        <div role="button" aria-label="Remove Love" id="remove"></div>
                        <div role="button" aria-label="Comment" id="comment"></div>
                        <span aria-label="Like" id="label"></span>
                    </div>
                </div>
                <div role="dialog" aria-modal="false" aria-labelledby="other-title">
                    <div role="button" aria-label="Like" id="other-dialog"></div>
                </div>
            `;
            expect([...fixture.querySelectorAll(selector)].map((node) => node.id))
                .toEqual(["like", "remove"]);
        });
    }
});
