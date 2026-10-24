import changeProfilePicture from "./changeProfilePicture.js";
import changeCoverPhoto from "./changeCoverPhoto.js";
import clearProfilePosts from "./clearProfilePosts.js";
import publishProfilePostsWithDates from "./publishProfilePostsWithDates.js";
import updateBio from "./updateBio.js";
import updateAbout from "./updateAbout.js";
import { actionError } from "../../graphql/errors.js";

export const profileActions = Object.freeze({
    avatar: changeProfilePicture, cover: changeCoverPhoto, "clear-posts": clearProfilePosts,
    "publish-posts": publishProfilePostsWithDates, bio: updateBio, about: updateAbout,
});

export function validateProfileAction(action, input = {}) {
    const fail = message => { throw actionError(message, "FACEBOOK_PROFILE_ACTION_INPUT_INVALID"); };
    if (!Object.hasOwn(profileActions, action)) fail("Невідома дія соціального профілю");
    const text = value => typeof value === "string" ? value.trim() : "";
    const image = value => {
        const result = text(value);
        if (!result || result.length > 4096 || !/\.(png|jpe?g|webp)$/i.test(result)) fail("Виберіть зображення JPG, PNG або WEBP");
        return result;
    };
    if (["avatar", "cover"].includes(action)) return { imagePath: image(input.imagePath) };
    if (action === "clear-posts") {
        if (input.confirmed !== true) fail("Підтвердьте очищення постів соціального профілю");
        return { confirmed: true };
    }
    if (action === "bio") {
        if (typeof input.value !== "string" || input.value.length > 101) fail("Bio має містити до 101 символу");
        return { value: input.value };
    }
    if (action === "about") {
        const education = text(input.education);
        const work = { company: text(input.work?.company), position: text(input.work?.position) };
        if (!education && !work.company && !work.position) fail("Вкажіть освіту або компанію та посаду");
        if (Boolean(work.company) !== Boolean(work.position)) fail("Для роботи вкажіть компанію та посаду разом");
        if ([education, work.company, work.position].some(value => value.length > 200)) fail("Поля мають містити до 200 символів");
        return { education, work };
    }
    if (!Array.isArray(input.posts) || !input.posts.length || input.posts.length > 50) fail("Оберіть від 1 до 50 фото-постів");
    return { posts: input.posts.map(post => {
        const date = text(post?.targetDate);
        const parsed = new Date(`${date}T12:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || parsed > new Date()) fail("Для кожного поста вкажіть дійсну минулу дату YYYY-MM-DD");
        const message = typeof post.text === "string" ? post.text : "";
        if (message.length > 60000) fail("Текст поста завеликий");
        return { mediaPaths: [image(post?.mediaPaths?.[0])], targetDate: date, text: message };
    }) };
}
