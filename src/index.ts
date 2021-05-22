import shibaSwapData from '@shibaswap/shibaswap-data-snoop';
import { parseBalanceMap } from './parse-balance-map'

import queries from './queries';

import { VESTING_POOL_ID, VESTING_START } from "./constants";
import redirects from './redirects.json';
import blacklist from './blacklist.json';

type Info = shibaSwapData.topdog.Info;

type Pools = shibaSwapData.topdog.Pool[];

type Claims = shibaSwapData.vesting.User[];

type User = shibaSwapData.topdog.User;

type UsersConsolidated = {
    address: string,
    amount: number
}[];

type Options = {
    startBlock?: number,
    endBlock: number,
    claimBlock?: number
};

type DataPart = {
    info: Info,
    pools: Pools,
    users: User[],
    claims: Claims
};

type Data = {
    beginning: DataPart,
    end: DataPart
};

export default async function getDistribution(options: Options) {
    options.startBlock = options.startBlock ?? VESTING_START;
    options.claimBlock = options.claimBlock ?? (await shibaSwapData.blocks.latestBlock()).number;
    //console.log("**************************")
    //console.log(options.claimBlock);
    // Fetch the data and redirect the addresses right away
    const data = redirect(await fetchData(options.startBlock, options.endBlock, options.claimBlock));
    console.log("************************===")
    console.log(data.end);
    const final = finalize(
        consolidate(data.beginning, options.startBlock),
        consolidate(data.end, options.endBlock),
        calculateTotalVested(data, options),
        data.end.claims
    );
    

    console.log("************************===")
    console.log(final);

    return {
        amounts: final.users,
        blacklisted: final.blacklisted,
        merkle: parseBalanceMap(final.users)
    };
}

async function fetchData(startBlock: number, endBlock: number, claimBlock: number) {
    const [
        infoBeginning, infoEnd,
        poolsBeginning, poolsEnd,
        usersBeginning, usersEnd,
        claimed
    ] = await Promise.all([
        queries.info(startBlock), queries.info(endBlock),
        queries.pools(startBlock), queries.pools(endBlock),
        queries.users(startBlock), queries.users(endBlock),
        queries.claims(claimBlock)
    ]);
    // console.log("###################################################");
    // console.log(infoBeginning, infoEnd, poolsBeginning, poolsEnd, usersBeginning, usersEnd, claimed);

    return ({
        beginning: {
            info: infoBeginning,
            pools: poolsBeginning,
            users: usersBeginning,
            claims: []
        },

        end: {
            info: infoEnd,
            pools: poolsEnd,
            users: usersEnd,
            claims: claimed
        }
    });
}

// Redirects addresses
function redirect(data: Data) {
    data.beginning.users.forEach(user => {
        user.address = redirects.find(redirect => user.address === redirect.from)?.to ?? user.address;
    });
    data.end.users.forEach(user => {
        user.address = redirects.find(redirect => user.address === redirect.from)?.to ?? user.address;
    });
    return data;
}

// // Removes duplicate and calculates balances
// function consolidate(data: DataPart, block: number) {
//     const [users, pools, totalAllocPoint] = [data.users, data.pools, data.info.totalAllocPoint];

//     // May run multiple times for one address if it's in multiple pools
//     const consolidated: UsersConsolidated = users.map(user => {
//         const userPools = users
//             .filter(u => user.address === u.address)
//             .filter(u => u.poolId !== VESTING_POOL_ID)

//         const pending = userPools.reduce((a, b) => {
//             return a + pendingBone(block, totalAllocPoint, pools, b)
//         }, 0)

//         const harvested = userPools.reduce((a, b) => a + b.boneHarvested, 0);

//         return ({
//             address: user.address,
//             amount: pending + harvested
//         });
//     });

//     // Removes duplicates
//     return consolidated
//         .filter((v,i,a) => a.findIndex(t => (t.address === v.address)) === i);
// }

// Removes duplicate and calculates balances
function consolidate(data: DataPart, block: number) {
    const [users, pools, totalAllocPoint] = [data.users, data.pools, data.info.totalAllocPoint];

    const newUsers = users.filter(u=>u.poolId == VESTING_POOL_ID);
    // May run multiple times for one address if it's in multiple pools
    const consolidated: UsersConsolidated = newUsers.map(user => {
        // const userPools = users
        //     .filter(u => user.address === u.address)
        //     .filter(u => u.poolId !== VESTING_POOL_ID)
        //const userPoolToken = user.amount;
        // const pending = userPools.reduce((a, b) => {
        //     return a + pendingBone(block, totalAllocPoint, pools, b)
        // }, 0)

        // const harvested = userPools.reduce((a, b) => a + b.boneHarvested, 0);
        console.log("::USER:: ", user);
        // var userPoolToken = 0;
        // if(user.poolId == VESTING_POOL_ID){
        //     userPoolToken = user.amount;
        // }
        const newAmount = Number((user.amount * 1000)/pools[1].sslpBalance);


        return ({
            address: user.address,
            amount: newAmount
        });
    });

    // const consolidated: UsersConsolidated = 

    console.log("consolidated: ", consolidated);

    // Removes duplicates
    return consolidated
        .filter((v,i,a) => a.findIndex(t => (t.address === v.address)) === i);
}

function finalize(usersBeginning: UsersConsolidated, usersEnd: UsersConsolidated, totalVested: number, claims: Claims) {
    // console.log("usersBeginning", usersBeginning);
    // console.log("usersEnd", usersEnd);
    // console.log("totalVested", totalVested);
    // console.log("claims", claims);
    const users = usersEnd.map(userEnd => {
        return ({
            address: userEnd.address,
            amount: userEnd.amount - (usersBeginning.find(usersBeginning => usersBeginning.address === userEnd.address)?.amount ?? 0)
        })
    });
    // const users = usersEnd;
    console.log("users:: ", users);

    const totalFarmed = users.reduce((a, b) => a + b.amount, 0);

    const fraction = totalVested / totalFarmed;

    console.log(
        "totalFarmed: ", totalFarmed,
        "\ntotalVested: ", totalVested,
        "\nfraction: ", fraction
    )

    return {
        users: users
            .filter(user => user.amount >= 1e-18)
            .filter(user => !blacklist.includes(user.address))
            .map(user => {
                // const vested = user.amount * fraction;

                // const claimed = claims.find(u => user.address === u.id)?.totalClaimed ?? 0;

                return ({
                    address: user.address,
                    vested: BigInt(((user.amount)))
                })
            })
            .filter(user => user.vested >= BigInt(0))
            .map(user => ({[user.address]: String(user.vested)}))
            .reduce((a, b) => ({...a, ...b}), {}),

        blacklisted: users
            .filter(user => user.amount >= 1e-18)
            .filter(user => blacklist.includes(user.address))
            .map(user => {
                const vested = user.amount * fraction;

                const claimed = claims.find(u => user.address === u.id)?.totalClaimed ?? 0;

                return ({
                    address: user.address,
                    vested: BigInt(Math.floor((vested - claimed) * 1e18))
                })
            })
            .filter(user => user.vested >= BigInt(0))
            .map(user => ({[user.address]: String(user.vested)}))
            .reduce((a, b) => ({...a, ...b}), {}),
    }
}

// function finalize(usersBeginning: UsersConsolidated, usersEnd: UsersConsolidated, totalVested: number, claims: Claims) {
//     console.log("usersBeginning", usersBeginning);
//     console.log("usersEnd", usersEnd);
//     console.log("totalVested", totalVested);
//     console.log("claims", claims);
//     const users = usersEnd.map(userEnd => {
//         return ({
//             address: userEnd.address,
//             amount: userEnd.amount - (usersBeginning.find(usersBeginning => usersBeginning.address === userEnd.address)?.amount ?? 0)
//         })
//     });
//     console.log("users:: ", users);

//     const totalFarmed = users.reduce((a, b) => a + b.amount, 0);

//     const fraction = totalVested / totalFarmed;

//     console.log(
//         "totalFarmed: ", totalFarmed,
//         "\ntotalVested: ", totalVested,
//         "\nfraction: ", fraction
//     )

//     return {
//         users: users
//             .filter(user => user.amount >= 1e-18)
//             .filter(user => !blacklist.includes(user.address))
//             .map(user => {
//                 const vested = user.amount * fraction;

//                 const claimed = claims.find(u => user.address === u.id)?.totalClaimed ?? 0;

//                 return ({
//                     address: user.address,
//                     vested: BigInt(Math.floor((vested - claimed) * 1e18))
//                 })
//             })
//             .filter(user => user.vested >= BigInt(0))
//             .map(user => ({[user.address]: String(user.vested)}))
//             .reduce((a, b) => ({...a, ...b}), {}),

//         blacklisted: users
//             .filter(user => user.amount >= 1e-18)
//             .filter(user => blacklist.includes(user.address))
//             .map(user => {
//                 const vested = user.amount * fraction;

//                 const claimed = claims.find(u => user.address === u.id)?.totalClaimed ?? 0;

//                 return ({
//                     address: user.address,
//                     vested: BigInt(Math.floor((vested - claimed) * 1e18))
//                 })
//             })
//             .filter(user => user.vested >= BigInt(0))
//             .map(user => ({[user.address]: String(user.vested)}))
//             .reduce((a, b) => ({...a, ...b}), {}),
//     }
// }

function calculateTotalVested(data: Data, options: Options) {
    const [startBlock, endBlock] = [options.startBlock, options.endBlock];

    const vestedStart = data.beginning.users
        .filter(user => user.poolId === VESTING_POOL_ID)
        .map(user => {
            const pending = pendingBone(startBlock!, data.beginning.info.totalAllocPoint, data.beginning.pools, user);
            const harvested = user.boneHarvested;
            return pending + harvested;
        })
        .reduce((a, b) => a + b, 0);

    const vestedEnd = data.end.users
        .filter(user => user.poolId === VESTING_POOL_ID)
        .map(user => {
            const pending = pendingBone(endBlock, data.end.info.totalAllocPoint, data.end.pools, user);
            const harvested = user.boneHarvested;
            return pending + harvested;
        })
        .reduce((a, b) => a + b, 0);

    return vestedEnd - vestedStart;
}

// Re-implementation of the pendingBone function from Masterchef
function pendingBone(block: number, totalAllocPoint: number, pools: Pools, user: User) {
    let poolId = user.poolId;
    let pool = pools.filter((entry) => entry.id === poolId ? true : false)[0]; // There's only going to be one

    let accBonePerShare = pool.accBonePerShare;
    if(block > pool.lastRewardBlock && pool.sslpBalance !== 0) {
        let multiplier = block - pool.lastRewardBlock;
        // console.log("************************")
        // console.log(multiplier, pool.allocPoint, accBonePerShare);
        let boneReward = BigInt(Math.floor(multiplier * 100 * 1e18 * pool.allocPoint / totalAllocPoint));
        accBonePerShare = accBonePerShare + boneReward * BigInt(1e12) / BigInt(Math.floor(pool.sslpBalance * 1e18));
    }

    return Number(
        (BigInt(user.amount) * accBonePerShare - user.rewardDebt * BigInt(1e12)) / BigInt(1e12)
    ) / 1e18;
}