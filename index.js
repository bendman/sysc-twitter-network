const api = require('./data/api');
const seed = require('./network-seed');
const fs = require('fs');
const util = require('util');
const path = require('path');

const writeFile = util.promisify(fs.writeFile);

async function getFriendEdges(id) {
    const friends = await api.getFriends(id);
    return {
        source: id,
        targetIds: friends
    };
}

// Get the intersection (shared set) of multiple arrays
const intersection = (...arrays) => {
    const result = [];
    const arraysCount = arrays.length;
    for (let iItem = 0, length = arrays[0].length; iItem < length; iItem++) {
        const item = arrays[0][iItem];
        if (result.includes(item)) continue;

        let iArray;
        for (iArray = 0; iArray < arraysCount; iArray++) {
            if (!arrays[iArray].includes(item)) break;
        }
        if (iArray === arraysCount) result.push(item);
    }
    return result;
};

async function getMutualFriends(userIds) {
    const userEdges = await Promise.all(userIds.map(id => getFriendEdges(id)));
    userEdges.sort((a, b) => a.targetIds.length < b.targetIds.length ? -1 : 1);

    return intersection(...userEdges.map(user => user.targetIds));
}

// Given a set of source userIds and an integer threshold, find all of the
// friends that at least `threshold` userIds have in common
async function getThresholdMutualFriends(userIds, threshold) {
    const userEdges = await Promise.all(userIds.map(id => getFriendEdges(id)));
    const friendsWithDups = [].concat(...userEdges.map(user => user.targetIds));
    friendsWithDups.sort();
    const friendInDegrees = friendsWithDups.reduce((agg, friendId) => {
        if (agg.length && agg[agg.length - 1].id === friendId) {
            agg[agg.length - 1].count += 1;
        } else {
            agg.push({ id: friendId, count: 1 });
        }
        return agg;
    }, []);

    return friendInDegrees.filter(
        friend => friend.count >= threshold
    ).map(friend => friend.id);
}

const objectsToCSV = (fields, objects) => [
    fields.slice(),
    ...(objects.map(object => fields.map(field => object[field])))
].map(row => row.join(',')).join('\n');

async function start() {
    const mutualFriends = await getThresholdMutualFriends(seed, 3);

    const thresholdFriends = await getThresholdMutualFriends(mutualFriends, 6);
    
    const seedFriendsEdges = await Promise.all(seed.map(id => getFriendEdges(id)));
    const thresholdFriendsEdges = await Promise.all(thresholdFriends.map(id => getFriendEdges(id)));
    const mutualFriendsEdges = await Promise.all(mutualFriends.map(id => getFriendEdges(id)));
    const filteredRawEdges = ([
        ...seedFriendsEdges,
        ...thresholdFriendsEdges,
        ...mutualFriendsEdges
    ]).filter(({ source }, i, inclusiveList) => 
       inclusiveList.findIndex(sourceItem => sourceItem.source === source) === i
    );

    const edges = [].concat(...filteredRawEdges.map(({ source, targetIds }) =>
        targetIds.map(target => ({ source, target }))
    ));

    let nodes = await api.getBulkUserData(thresholdFriends);
    nodes.forEach(node => {
        const textContent = [
            (node.description || ''),
            ((node.status && node.status.text) || '')
        ].join();
        node.hasKeyword = /(network|system|complex|social sci)/i.test(textContent) ? 1 : 0;
        node.isLocal = /(Portland|Oregon|\WOR\W)/i.test(node.location);
    });
    nodes = nodes.filter(node => 
        thresholdFriends.includes(node.id) && node.followers_count < 4e5
    );
    const nodeIds = nodes.map(node => node.id);

    const filteredEdges = edges.filter(edge => nodeIds.includes(edge.target) && nodeIds.includes(edge.source));

    const filteredEdgesCSV = filteredEdges.map(edge => [edge.source, edge.target].join(',')).join('\n');
    await writeFile(path.resolve(__dirname, `./output-filtered-edges.csv`), filteredEdgesCSV);

    const nodesCSV = objectsToCSV([
        'id',
        'name',
        'screen_name',
        'followers_count',
        'friends_count',
        'hasKeyword',
        'isLocal',
    ], nodes);
    await writeFile(path.resolve(__dirname, `./output-filtered-nodes.csv`), nodesCSV);
}

start();