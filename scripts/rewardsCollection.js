const mongoose = require('mongoose');

var rewardsCollection = new mongoose.Schema({
    block_number: {
        type: Number,
        required: 'This field is required.'
    },
    contract: {
        type: String,
        required: 'This field is required.'
    },
    user_share_map: {
        type: Map,
        required: 'This field is required.'
    },
    user_share: {
        type: Object,
        required: 'This field is required.'
    },
    normalize_exponent: {
        type: Number,
        required: 'This field is required.'
    },
    date: {
        type: Number,
        required: 'This field is required.'
    }
});

mongoose.model('rewardsCollection', rewardsCollection);