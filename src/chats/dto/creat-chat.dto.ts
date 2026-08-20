import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateChatDto {
  @IsIn(['direct', 'group'])
  type!: 'direct' | 'group';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  memberIds!: string[];
}
