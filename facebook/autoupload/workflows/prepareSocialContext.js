import HttpActionContext from "../HttpActionContext.js";
import HttpPageActionContext from "../HttpPageActionContext.js";
import switchToFanPage from "../actions/pages/switchToFanPage.js";
import { actionError } from "../graphql/errors.js";

// Початковий GET уже підтвердив власника cookies; повторне читання потрібне лише після перемикання.
export default async function prepareSocialContext(client, profileId, { signal } = {}) {
    let fbData = client.getFbData(profileId);
    if (fbData.actorId !== fbData.accountId) {
        const session = fbData.session;
        const context = new HttpPageActionContext(client, { signal, identity: {
            accountId: fbData.accountId, actorId: fbData.actorId,
            runtime: { av: fbData.actorId, __user: fbData.actorId, __a: "1",
                fb_dtsg: session.fb_dtsg, lsd: session.lsd, jazoest: session.jazoest,
                __comet_req: session.cometReq, __spin_r: session.spinR, __spin_b: session.spinB, __spin_t: session.spinT },
        } });
        await client.run(() => switchToFanPage(context, fbData.accountId));
        fbData = client.getFbData(profileId);
    }
    if (fbData.actorId !== fbData.accountId) throw actionError("Не вдалося перейти на соціальний профіль", "FACEBOOK_SOCIAL_CONTEXT_REQUIRED");
    client.validateFbData(fbData);
    return { fbData, context: new HttpActionContext(fbData, { signal, session: fbData.session }) };
}
