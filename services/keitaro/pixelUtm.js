export function buildPixelUtm(pixelId, token = "") {
    const id = String(pixelId ?? "").trim();
    const accessToken = String(token ?? "").trim();
    if (!id) return "";
    return `utm_campaign={{campaign.name}}&utm_source={{site_source_name}}&utm_placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&adset_name={{adset.name}}&pixel=${id}&ad_name={{ad.name}}${accessToken ? `&token=${accessToken}` : ""}`;
}
