const webpush=require('web-push');
const keys=require('keys.json');

webpush.setVapidDetails(
    'mailto:sucorreo',
    keys.pulbicKey,
    keys.privateKey
);

function sendPush(req, res){
    const sub={/*suscripcion*/}
    webpush.sendNotification(sub, "{'titulo':'hola', 'mensaje':'holis', 'icon': 'nameimagen.jpg'}")
    .then(succes=>{
        res.json({menesaje:"ok"})
    })
    .catch(async error=>{
        if(error.body.includes('expired') && error.statusCode==410){
            console.log('suscripcion expirada')
            }
        })
}