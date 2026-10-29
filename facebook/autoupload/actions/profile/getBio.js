import { buildMutationBody, parseFacebookJson } from "../../../api/browserRequest.js";
import { defaultRelayVariables } from "../../../api-actions/education/getEducationExperiences.js";
import { actionError } from "../../graphql/errors.js";

// Читає Bio з поточної секції About; невідомий формат не вважається порожнім полем.
export default async function getBio(context, tokens) {
    if (!tokens.rawSectionToken) throw actionError("Відсутній токен секції Bio", "FACEBOOK_BIO_READ_FAILED");
    const runtime = await context.readRuntime();
    const friendlyName = "ProfileCometAboutAppSectionQuery";
    const response = await context.postForm({ friendlyName, body: buildMutationBody(runtime, {
        friendlyName, docId: "28648420368126790",
        variables: { ...defaultRelayVariables, ...tokens,
            appSectionFeedKey: `ProfileCometAppSectionFeed_timeline_nav_app_sections__${tokens.rawSectionToken}`,
            pageID: runtime.av, userID: runtime.av, scale: 1, showReactions: true },
    }) });
    const data = parseFacebookJson(response.body);
    const nodes = data?.data?.user?.about_app_sections?.nodes;
    if (Array.isArray(nodes)) {
        for (const node of nodes) {
            for (const collection of node.activeCollections?.nodes ?? []) {
                for (const section of collection.style_renderer?.profile_field_sections ?? []) {
                    if (section.field_section_type !== "directory_bio") continue;
                    const fields = section.profile_fields?.nodes;
                    if (!Array.isArray(fields)) continue;
                    const values = fields.filter(field => field.field_type !== "upsell");
                    if (!values.length) return "";
                    const field = values[0];
                    const bio = field.edit_renderer?.bio;
                    const value = typeof bio === "string" ? bio : bio?.text ?? field.title?.text;
                    if (typeof value === "string") return value;
                }
            }
        }
    }
    throw actionError("Не вдалося визначити поточне Bio з відповіді Facebook", "FACEBOOK_BIO_READ_FAILED");
}
