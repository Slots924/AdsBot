import { buildMutationBody, parseFacebookJson } from "../../../api/browserRequest.js";
import { actionError } from "../../graphql/errors.js";

// Повторює запит редактора Bio: null означає порожнє поле, невідомий формат залишається помилкою.
export default async function getBio(context) {
    const runtime = await context.readRuntime();
    const friendlyName = "ProfileCometBioTextEditorPrivacyIconQuery";
    const response = await context.postForm({ friendlyName, body: buildMutationBody(runtime, {
        friendlyName, docId: "23931151619841616", variables: { id: runtime.av },
    }) });
    const data = parseFacebookJson(response.body);
    const bio = data?.data?.user?.profile_intro_card?.bio;
    if (bio === null) return "";
    if (typeof bio?.text === "string") return bio.text;
    throw actionError("Не вдалося визначити поточне Bio з відповіді Facebook", "FACEBOOK_BIO_READ_FAILED");
}
