import getCoreTokens from "../../../api-actions/getAboutSectionTokens.js";
import { actionError } from "../../graphql/errors.js";

// Кожне звернення читає колекцію заново; результат не зберігається між діями.
export default async function getAboutSectionTokens(context, section) {
    const result = await getCoreTokens({ page: context, sections: [section] });
    const tokens = result.data?.[section];
    if (!result.success || !tokens) throw actionError("Не вдалося отримати актуальні токени секції About", "FACEBOOK_ABOUT_TOKENS_MISSING", { actionRequired: "refresh_session" });
    return tokens;
}
