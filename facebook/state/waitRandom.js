async function waitRandom(minMilliseconds, maxMilliseconds) {
    const delay = Math.floor(
        Math.random() * (maxMilliseconds - minMilliseconds + 1)
    ) + minMilliseconds;

    await new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}


export default waitRandom;
