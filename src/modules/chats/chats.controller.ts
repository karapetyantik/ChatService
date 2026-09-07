import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  Param,
  Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { ChatsService } from './chats.service';
import { CreateChatDto } from './dto/creatе-chat.dto';
import { AddMembersDto } from './dto/add-members.dto';

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateChatDto) {
    return this.chatsService.createChat(req.user.userId, dto);
  }

  @Get()
  myChats(@Req() req: any) {
    return this.chatsService.getUserChats(req.user.userId);
  }

  @Post(':chatId/members')
  addMembers(
    @Req() req: any,
    @Param('chatId') chatId: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.chatsService.addMembers(chatId, req.user.userId, dto.memberIds);
  }

  @Delete(':chatId/members/:userId')
  removeMember(
    @Req() req: any,
    @Param('chatId') chatId: string,
    @Param('userId') userId: string,
  ) {
    return this.chatsService.removeMember(chatId, req.user.userId, userId);
  }

  @Post(':chatId/read')
  markAsRead(
    @Req() req: any,
    @Param('chatId') chatId: string,
    @Body('messageId') messageId: string,
  ) {
    return this.chatsService.markAsRead(chatId, req.user.userId, messageId);
  }
}
