const fs = require('fs');
const path = require('path');
const util = require('util');
const Twitter = require('twitter');

require('dotenv').config(); // Load local config for API keys

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const client = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

async function getFriends(id) {
    try {
        const friends = await client.get('friends/ids', { user_id: id });
        return friends.ids;
    } catch (error) {
        console.log('API Request Error', error);
        return [];
    }
}

async function getBulkUserData(userIds) {
    try {
        const userData = await client.post('users/lookup', { user_id: userIds.slice(0, 99).join(',') });
        return userData.map(user => ({ argKey: user.id, data: user }));
    } catch (error) {
        console.log('API Request Error', error, userIds);
        if (error[0].code === 17) {
            return userIds.map(userId => ({
                argKey: userId,
                data: null,
                error: error[0],
            }));
        }
        return [];
    }
}

async function readBundleCacheItem(tgtFnName, id) {
    try {
        const content = await readFile(path.resolve(__dirname, `./cache/${tgtFnName}-${id}.json`));
        return {
            cached: true,
            argKey: id,
            data: JSON.parse(content).data,
        };
    } catch (error) {
        console.log('missed cache', id);
        return {
            argKey: id,
            data: null,
        };
    }
}

async function cacheBundledItem(tgtFnName, item) {
    try {
        const file = path.resolve(__dirname, `./cache/${tgtFnName}-${item.argKey}.json`);
        await writeFile(file, JSON.stringify({ data: item.data }, null, 2));
    } catch (error) {
        console.log('writing bundle item cache error', item.argKey, error);
    }
}

async function cachedBundledApi(tgtFn, ...args) {
    try {
        const cachedItemResults = await Promise.all(args[0].map(id => readBundleCacheItem(tgtFn.name, id)));
        const cacheHits = cachedItemResults.filter(result => result.cached === true);
        const cacheMisses = cachedItemResults.filter(result => result.cached !== true);

        console.log('bundle cache', { hits: cacheHits.length, misses: cacheMisses.length });

        const newItems = !cacheMisses.length ? [] : await tgtFn.call(null, cacheMisses.map(item => item.argKey));

        await Promise.all(newItems.map(item => cacheBundledItem(tgtFn.name, item)));

        const results = [ ...cacheHits, ...newItems ].map(item => item.data);
        return results.filter(data => data !== null);
    } catch (error) {
        console.log('bundled api error', error);
    }
}

async function cachedApi(tgtFn, ...args) {
    const pathArgs = args.join('-');
    const cachedPath = path.resolve(__dirname, `./cache/${tgtFn.name}-${pathArgs}.json`);

    try { 
        // Get the cached version if available
        const content = await readFile(cachedPath);
        return JSON.parse(content).data;
    } catch (error) { 
        // Call API function and cache results
        console.log('cache lookup fail', error);

        const data = await tgtFn.apply(null, args);
        fs.writeFileSync(cachedPath, JSON.stringify({ data }, null, 2));

        return data;
    }
}

module.exports = {
    getFriends: cachedApi.bind(null, getFriends),
    getBulkUserData: cachedBundledApi.bind(null, getBulkUserData),
};