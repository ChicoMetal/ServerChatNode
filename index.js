var express = require('express'),
	http	= require('http'),
	socket 	= require('socket.io'),
	mysql	= require('mysql'),
	bodyParser = require('body-parser');

//json para guardar los ID de cada socket con su respectivo Id del usuario
var JsonIdSocket = [];

//variables

var JsonResponseMsm = {
	resA1 : {msm:"0000"}, /* error al conectar  */
	resA2 : {msm:"0001"}, /* error al ejecutar el query */
	resA3 : {msm:"0010"}, /* No existen datos*/
	resA4 : {msm:"1000"}, /* Query ejecutado correctamente */
	resA5 : {msm:"0100"}, /* error al seleccionar la tabla*/
	resB2 : {msm:"0011"}, /* Error en la instruccion*/
	resB3 : {msm:"1100"}, /* Instruccion ejecutada correctamente*/
	resB4 : {msm:"1101"} /* Peticion indeterminada */
};


//configurar conexion a la BD
var connection = mysql.createConnection({
	host: 'localhost',
	user: 'root',
	password: '',
	database: 'bienestarcun'
})
//configurar conexion a la BD remota
/*var connection = mysql.createConnection({
	host: 'www.db4free.net',
	user: 'krlos1991',
	password: '19915991',
	database: 'bienestarcun'
})
*/
//crear aplicacion
var app 	= express();
var server	= http.createServer(app);
var io 		= socket(server);


//obtener parametros por enviados por post en json 
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

//configurar motor de plantillas
app.set('views', __dirname+'/app/views');
app.set('view engine', 'jade');
app.locals.pretty = true;

//configurar archivos estaticos
app.use('/bower_components', express.static(__dirname+'/bower_components') );

//obtener mensajes guardados en la BD
app.post('/messages', function(req, res){		

	if( (req.body.Receptor && req.body.Remitente ) 
		&& (req.body.Receptor != '' && req.body.Remitente != '' )
		){//valido que existan los parametros y no esten vacios

			var query = "SELECT cp.Id, cp.Remitente, cp.Mensaje\
						FROM chatpsicologia cp\
						WHERE ( (cp.Remitente = "+req.body.Receptor+"\
							  AND cp.Destinatario = "+req.body.Remitente+")\
							  OR (cp.Remitente = "+req.body.Remitente+"\
							  AND cp.Destinatario = "+req.body.Receptor+"))\
							  AND cp.Estado = FALSE\
						ORDER BY cp.Fecha";//instruccion buscar mensajes sin leer

			connection.query(query, function(err, message){//hago la peticion al servidor
				if( err ){//si hubo un error en la ejecucion del query
					res.header('Content-Type', 'application/json');
					res.send( JsonResponseMsm.resA2 );
				}else{//de lo contrario retorno los resultados					
					res.header('Content-Type', 'application/json');
					res.send( message );
				}

			});
	}else{//si los parametros no son validos retorno error

		res.header('Content-Type', 'application/json');
		res.send( JsonResponseMsm.resB4 );
	}
});

//creando rutas de la aplicacion
app.get('/', function(req, res){
	res.render('index');
});

//configurar socket.io para escuchar eventos desde el cliente
io.on('connection', function(socket){
	console.log('Usuario conectado');
		
	socket.on('new message', function(message){//Al enviarse un mensaje desde el cliente
		if( (message.Mensaje && message.Remitente && message.Destinatario )
			&& (message.Mensaje != '' && message.Remitente != '' && message.Destinatario != '') 
			){//valido los parametros del mensaje 

			if( VerificarSocketRemitente(message.Remitente) ){//verifico que el remitente tenga registrado el socket 

				console.log(message.Remitente+" ha enviado un mensaje");
				//guardar mensaje en la BD

				var query = 'INSERT INTO chatpsicologia SET ?';

				connection.query( query, message, function(err, result){
					if( err ){//si hubo un error en la instruccion
						io.to(socket.id).emit('response error', JsonResponseMsm.resA2);											
					}else{//de lo contrario acciono el evento para enviar los mensajes
						
						var idSocket = ReturnSocketId(message.Remitente, message.Destinatario);
						
						io.to(socket.id).emit('new message', message);
						
						if( idSocket != false ){//verifico si el destinatario tiene un socket creado							
							io.to("/#"+idSocket).emit('new message', message);
							UpdateStatusMsm(message.Mensaje, message.Remitente, message.Destinatario); //actualizar estado mensaje

						}
					}

				});
			}else{				
				io.to(socket.id).emit('response error', JsonResponseMsm.resB4);
			}
		}else{				
			io.to(socket.id).emit('response error', JsonResponseMsm.resB4);
		}

	});

	socket.on('saveIdSocket', function( data ){//obtiene el id del socket y el ID del usuario propietario del socket
		
		if( ValidateIfSocketExists(data.socket) ){			
			JsonIdSocket.push({//almacenar datos de la conversacion	
							'socket':data.socket, 
							'remitente':data.remitente,
							'receptor':data.receptor});

			
			io.to(socket.id).emit('saveIdSocket', {'status':true});
		}
		
	});

	socket.on('disconnect', function(){
		DeleteSocketConversasion(socket.id);//remuevo el usuario de el objeto con los id de los socket
		console.log('Usuario desconectado.. ');

	});
});

//iniciar el servidor
server.listen(process.env.PORT || 3000, function(){
	console.log('Server iniciado en el puerto 3000 ||'+process.env.PORT);
});

function UpdateStatusMsm( Msm, Remitente, Destinatario ){
//Actualizar el estado del mensaje enviado, cuando el destinatario lo recive inmediatamente
	
	var query = 'UPDATE chatpsicologia SET Estado = TRUE WHERE Mensaje = ?\
				 AND Remitente = ? AND Destinatario = ?';

	connection.query( query, [Msm, Remitente, Destinatario], function(err, result){
		if( err ){//si hubo un error en la instruccion
			console.log("Error al actualizar el estado de un mensaje");											
		}else{//de lo contrario acciono el evento para enviar los mensajes
			
			console.log("Estado de mensaje actualizado");
		}

	});
}

function ReturnSocketId(Remitente, Receptor){
//funcion para buscar el socket de la conversasion del destinatario del mensaje

	for (var i=0; i < JsonIdSocket.length; i++){
		if(JsonIdSocket[i].remitente == Receptor && JsonIdSocket[i].receptor == Remitente){			
			return JsonIdSocket[i].socket;
		}
	}

	return false;
	
}

function ValidateIfSocketExists(socket){
//verifico si el socket ya esta guardado

	for (var i=0; i < JsonIdSocket.length; i++){
		if(JsonIdSocket[i].socket == socket )
			return false;
	}
	return true;
}

function VerificarSocketRemitente(Remitente){
//funcion para verificar q un remitente tenga un socket guardado
	for (var i=0; i < JsonIdSocket.length; i++){		
		if(JsonIdSocket[i].remitente == Remitente ){
			return true;		
		}
	}
	
	return false;	
}

function DeleteSocketConversasion(Socket){
//Elimino el objeto que contenga el socket enviado para eliminar una conversaion

	for (var i=0; i < JsonIdSocket.length; i++){
		if( ("/#"+JsonIdSocket[i].socket) == Socket )
			JsonIdSocket.splice(i, 1);
		
	}

}